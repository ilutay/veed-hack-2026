import "./server-only";

import {
  canonicalSha256,
  canonicalizeJson,
  sha256Hex,
  verifyFalSourceRefs,
  FalSourceRefSchema,
  type AllowedFalTransform,
  type FalSourceRef,
} from "../pioneer";
import { loadStimulusReceiptSkill, toSkillReceipt } from "./skill-loader";
import type { JsonValue, SkillReceipt } from "./types";

const MAX_RAW_TEXT_BYTES = 64 * 1024;
const MAX_FIELDS = 128;
const MAX_SOURCE_REFS_PER_FIELD = 8;

export interface RawFalTextReceiptInput {
  providerRequestId: string;
  providerModelId: string;
  rawText: string;
  expectedRawTextSha256: string;
  sourceAssetSha256: string;
  receivedAt: string;
}

export interface FalSpanInput {
  providerRequestId: string;
  startUtf8Byte: number;
  endUtf8Byte: number;
  transform: AllowedFalTransform;
}

export interface FalGroundedFieldInput {
  /** Stable manifest path, for example `observations[0].visibleCopy[0].text`. */
  path: string;
  /** Expected JSON value; verification proves the allowed transform yields it. */
  value: JsonValue;
  sourceSpans: FalSpanInput[];
}

export interface PrepareStimulusReceiptInput {
  normalizerVersion: string;
  rawReceipts: RawFalTextReceiptInput[];
  fields: FalGroundedFieldInput[];
}

export interface PreparedFalField {
  path: string;
  value: JsonValue;
  sourceRefs: FalSourceRef[];
}

export interface PreparedStimulusReceipt {
  receiptId: string;
  receiptSha256: string;
  normalizerVersion: string;
  evidenceBoundary: "fal_text_only_not_pixel_verification";
  rawReceipts: Array<{
    providerRequestId: string;
    providerModelId: string;
    rawTextSha256: string;
    rawTextUtf8ByteLength: number;
    sourceAssetSha256: string;
    receivedAt: string;
  }>;
  fields: PreparedFalField[];
  skillReceipt: SkillReceipt;
}

function assertSha256(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
}

function assertSafeExactSourceText(text: string, path: string): void {
  if (
    /https?:\/\//iu.test(text) ||
    /\bdata:[^\s,]+;base64,/iu.test(text) ||
    /\bauthorization\s*:/iu.test(text)
  ) {
    throw new Error(`${path} contains a URL, base64 payload, or auth header`);
  }
}

function extractExactSourceText(
  rawText: string,
  span: FalSpanInput,
  path: string,
): string {
  const rawBytes = Buffer.from(rawText, "utf8");
  if (
    !Number.isInteger(span.startUtf8Byte) ||
    !Number.isInteger(span.endUtf8Byte) ||
    span.startUtf8Byte < 0 ||
    span.endUtf8Byte <= span.startUtf8Byte ||
    span.endUtf8Byte > rawBytes.byteLength
  ) {
    throw new Error(`${path} has an out-of-range UTF-8 byte span`);
  }

  const bytes = rawBytes.subarray(span.startUtf8Byte, span.endUtf8Byte);
  const text = bytes.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== bytes.byteLength) {
    throw new Error(`${path} does not start and end on UTF-8 boundaries`);
  }
  if (bytes.byteLength > 256) {
    throw new Error(`${path} exceeds the 256-byte fal excerpt limit`);
  }
  assertSafeExactSourceText(text, path);
  return text;
}

/**
 * Builds field-level fal lineage without asking a model to describe pixels.
 * Raw fal text is verified in memory and omitted from the returned receipt.
 */
export async function prepareStimulusReceipt(
  input: PrepareStimulusReceiptInput,
  options: { repoRoot?: string } = {},
): Promise<PreparedStimulusReceipt> {
  if (!input.normalizerVersion.trim()) {
    throw new Error("normalizerVersion is required");
  }
  if (input.rawReceipts.length < 1 || input.rawReceipts.length > 2) {
    throw new Error("prepare_stimulus_receipt accepts one or two fal receipts");
  }
  if (input.fields.length < 1 || input.fields.length > MAX_FIELDS) {
    throw new Error(`fields must contain between 1 and ${MAX_FIELDS} entries`);
  }

  const rawByRequestId = new Map<string, RawFalTextReceiptInput>();
  for (const receipt of input.rawReceipts) {
    if (rawByRequestId.has(receipt.providerRequestId)) {
      throw new Error(`duplicate fal request ID: ${receipt.providerRequestId}`);
    }
    assertSha256(receipt.expectedRawTextSha256, "expectedRawTextSha256");
    assertSha256(receipt.sourceAssetSha256, "sourceAssetSha256");
    const rawBytes = Buffer.from(receipt.rawText, "utf8");
    if (rawBytes.byteLength < 1 || rawBytes.byteLength > MAX_RAW_TEXT_BYTES) {
      throw new Error(
        `fal text for ${receipt.providerRequestId} must be 1-${MAX_RAW_TEXT_BYTES} UTF-8 bytes`,
      );
    }
    if (sha256Hex(rawBytes) !== receipt.expectedRawTextSha256) {
      throw new Error(`fal text digest mismatch for ${receipt.providerRequestId}`);
    }
    rawByRequestId.set(receipt.providerRequestId, receipt);
  }

  const seenPaths = new Set<string>();
  const fields: PreparedFalField[] = [];
  for (const field of input.fields) {
    if (!field.path.trim() || seenPaths.has(field.path)) {
      throw new Error(`field path is empty or duplicated: ${field.path}`);
    }
    seenPaths.add(field.path);
    canonicalizeJson(field.value);
    if (
      field.sourceSpans.length < 1 ||
      field.sourceSpans.length > MAX_SOURCE_REFS_PER_FIELD
    ) {
      throw new Error(
        `${field.path} must have 1-${MAX_SOURCE_REFS_PER_FIELD} source spans`,
      );
    }

    const sourceRefs: FalSourceRef[] = field.sourceSpans.map((span, index) => {
      const rawReceipt = rawByRequestId.get(span.providerRequestId);
      if (!rawReceipt) {
        throw new Error(
          `${field.path}.sourceSpans[${index}] names an unknown fal request`,
        );
      }
      const exactSourceText = extractExactSourceText(
        rawReceipt.rawText,
        span,
        `${field.path}.sourceSpans[${index}]`,
      );
      return FalSourceRefSchema.parse({
        providerRequestId: span.providerRequestId,
        rawTextSha256: rawReceipt.expectedRawTextSha256,
        startUtf8Byte: span.startUtf8Byte,
        endUtf8Byte: span.endUtf8Byte,
        exactSourceText,
        transform: span.transform,
      });
    });

    await verifyFalSourceRefs(
      sourceRefs,
      (providerRequestId) => rawByRequestId.get(providerRequestId)?.rawText,
      { expectedValue: field.value, path: field.path },
    );
    fields.push({ path: field.path, value: field.value, sourceRefs });
  }

  fields.sort((left, right) => left.path.localeCompare(right.path));
  const skill = await loadStimulusReceiptSkill(options.repoRoot);
  const rawReceipts = input.rawReceipts
    .map((receipt) => ({
      providerRequestId: receipt.providerRequestId,
      providerModelId: receipt.providerModelId,
      rawTextSha256: receipt.expectedRawTextSha256,
      rawTextUtf8ByteLength: Buffer.byteLength(receipt.rawText, "utf8"),
      sourceAssetSha256: receipt.sourceAssetSha256,
      receivedAt: receipt.receivedAt,
    }))
    .sort((left, right) =>
      left.providerRequestId.localeCompare(right.providerRequestId),
    );
  const receiptProjection = {
    normalizerVersion: input.normalizerVersion,
    evidenceBoundary: "fal_text_only_not_pixel_verification" as const,
    rawReceipts,
    fields,
    skillReceipt: toSkillReceipt(skill),
  };
  const receiptSha256 = canonicalSha256(receiptProjection);

  return {
    receiptId: `faltext_${receiptSha256.slice(0, 32)}`,
    receiptSha256,
    ...receiptProjection,
  };
}
