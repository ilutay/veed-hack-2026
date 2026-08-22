import {
  canonicalSha256,
  canonicalizeJson,
  computeGroundedStimulusProjectionHash,
  computeSpotCheckReceiptHash,
  computeTextStimulusManifestHash,
  sha256Hex,
} from "./canonical";
import type {
  FalSourceRef,
  GymSpec,
  TextStimulusManifest,
} from "./schemas";

export type FalTextResolver = (
  providerRequestId: string,
) => Promise<string | null | undefined> | string | null | undefined;

export class FalLineageError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "FalLineageError";
    this.path = path;
  }
}

interface GroundedValue {
  value: unknown;
  sourceRefs: FalSourceRef[];
}

function isGroundedValue(value: unknown): value is GroundedValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return "value" in candidate && Array.isArray(candidate.sourceRefs);
}

function collectGroundedValues(
  value: unknown,
  path: string,
  collected: Array<{ path: string; grounded: GroundedValue }>,
): void {
  if (isGroundedValue(value)) {
    collected.push({ path, grounded: value });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectGroundedValues(entry, `${path}[${index}]`, collected),
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectGroundedValues(entry, `${path}.${key}`, collected);
    }
  }
}

function parseJsonSource(source: string, path: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new FalLineageError(path, "transform requires an explicit JSON literal");
  }
}

const EXACT_ENUM_MAP: Readonly<Record<string, string>> = Object.freeze({
  equal: "equal",
  intentionally_varied: "intentionally_varied",
  unverified: "unverified",
});

function applyAllowedTransform(
  source: string,
  sourceRef: FalSourceRef,
  expectedValue: unknown,
  path: string,
): unknown {
  switch (sourceRef.transform) {
    case "identity":
      return typeof expectedValue === "string" ? source : parseJsonSource(source, path);
    case "trim_whitespace":
      if (typeof expectedValue !== "string") {
        throw new FalLineageError(path, "trim_whitespace only produces text");
      }
      return source.trim();
    case "unicode_nfc":
      if (typeof expectedValue !== "string") {
        throw new FalLineageError(path, "unicode_nfc only produces text");
      }
      return source.normalize("NFC");
    case "exact_enum_map": {
      const mapped = EXACT_ENUM_MAP[source.trim()];
      if (mapped === undefined) {
        throw new FalLineageError(path, "value is absent from the pinned enum map");
      }
      return mapped;
    }
    case "parse_explicit_number": {
      const normalized = source.trim();
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)) {
        throw new FalLineageError(path, "source is not an explicit JSON number");
      }
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) {
        throw new FalLineageError(path, "source number is not finite");
      }
      return parsed;
    }
    case "split_explicit_list": {
      const parsed = parseJsonSource(source, path);
      if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
        throw new FalLineageError(
          path,
          "split_explicit_list requires an explicit JSON string array",
        );
      }
      return parsed;
    }
    case "normalize_explicit_coordinates": {
      const parsed = parseJsonSource(source, path);
      if (
        Array.isArray(parsed) &&
        parsed.length === 4 &&
        parsed.every((entry) => typeof entry === "number" && entry >= 0 && entry <= 1)
      ) {
        return parsed;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const coordinates = parsed as Record<string, unknown>;
        const fields = ["x", "y", "width", "height", "canvasWidth", "canvasHeight"];
        if (fields.every((field) => typeof coordinates[field] === "number")) {
          const x = coordinates.x as number;
          const y = coordinates.y as number;
          const width = coordinates.width as number;
          const height = coordinates.height as number;
          const canvasWidth = coordinates.canvasWidth as number;
          const canvasHeight = coordinates.canvasHeight as number;
          if (
            canvasWidth > 0 &&
            canvasHeight > 0 &&
            x >= 0 &&
            y >= 0 &&
            width >= 0 &&
            height >= 0
          ) {
            return [
              x / canvasWidth,
              y / canvasHeight,
              width / canvasWidth,
              height / canvasHeight,
            ];
          }
        }
      }
      throw new FalLineageError(
        path,
        "coordinates must be explicit normalized values or receipt-bound dimensions",
      );
    }
    case "exact_equality_compare": {
      const parsed = parseJsonSource(source, path);
      if (!Array.isArray(parsed) || parsed.length !== 2) {
        throw new FalLineageError(
          path,
          "exact_equality_compare requires an explicit two-value JSON array",
        );
      }
      const isEqual = canonicalizeJson(parsed[0]) === canonicalizeJson(parsed[1]);
      return typeof expectedValue === "boolean"
        ? isEqual
        : isEqual
          ? "equal"
          : "unverified";
    }
  }
}

function reconstructGroundedValue(
  sourceValues: unknown[],
  expectedValue: unknown,
): unknown {
  if (sourceValues.length === 1) return sourceValues[0];
  if (typeof expectedValue === "string") {
    if (sourceValues.some((value) => typeof value !== "string")) return sourceValues;
    return (sourceValues as string[]).join("");
  }
  if (Array.isArray(expectedValue)) {
    return sourceValues.flatMap((value) => (Array.isArray(value) ? value : [value]));
  }
  return sourceValues;
}

function assertCanonicalEqual(actual: unknown, expected: unknown, path: string): void {
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) {
    throw new FalLineageError(path, "allowed transform does not reconstruct value exactly");
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export async function verifyFalSourceRefs(
  sourceRefs: FalSourceRef[],
  resolveFalText: FalTextResolver,
  options: { expectedValue?: unknown; path?: string } = {},
): Promise<void> {
  const path = options.path ?? "sourceRefs";
  const transformed: unknown[] = [];
  for (const [index, sourceRef] of sourceRefs.entries()) {
    const refPath = `${path}[${index}]`;
    const rawText = await resolveFalText(sourceRef.providerRequestId);
    if (typeof rawText !== "string") {
      throw new FalLineageError(refPath, "raw fal text is unavailable");
    }
    const rawBytes = Buffer.from(rawText, "utf8");
    if (sha256Hex(rawBytes) !== sourceRef.rawTextSha256) {
      throw new FalLineageError(refPath, "raw fal text digest mismatch");
    }
    if (
      sourceRef.startUtf8Byte < 0 ||
      sourceRef.endUtf8Byte > rawBytes.byteLength ||
      sourceRef.endUtf8Byte <= sourceRef.startUtf8Byte
    ) {
      throw new FalLineageError(refPath, "source byte span is out of range");
    }
    const exactBytes = rawBytes.subarray(
      sourceRef.startUtf8Byte,
      sourceRef.endUtf8Byte,
    );
    const exactSourceText = exactBytes.toString("utf8");
    if (
      Buffer.byteLength(exactSourceText, "utf8") !== exactBytes.byteLength ||
      exactSourceText !== sourceRef.exactSourceText
    ) {
      throw new FalLineageError(refPath, "source span is not an exact UTF-8 excerpt");
    }
    if ("expectedValue" in options) {
      transformed.push(
        applyAllowedTransform(
          exactSourceText,
          sourceRef,
          options.expectedValue,
          refPath,
        ),
      );
    }
  }

  if ("expectedValue" in options) {
    assertCanonicalEqual(
      reconstructGroundedValue(transformed, options.expectedValue),
      options.expectedValue,
      `${path}.value`,
    );
  }
}

export interface VerifiedFalManifest {
  manifestId: string;
  providerRequestId: string;
  rawTextSha256: string;
  groundedStimulusProjectionSha256: string;
  manifestSha256: string;
  evidenceMode: "audited_demo_fixture" | "session_receipt";
  sourceRefCount: number;
}

/**
 * Verifies a fal text receipt. This function never creates visual observations:
 * it can only reconstruct values that are already present in immutable fal text.
 */
export async function verifyFalManifest(
  manifest: TextStimulusManifest,
  resolveFalText: FalTextResolver,
  options: { reusableFixtureId?: string } = {},
): Promise<VerifiedFalManifest> {
  const rawText = await resolveFalText(manifest.falReceipt.providerRequestId);
  if (typeof rawText !== "string") {
    throw new FalLineageError(
      "falReceipt.providerRequestId",
      "raw fal text is unavailable; the gateway will not infer missing observations",
    );
  }

  const rawBytes = Buffer.from(rawText, "utf8");
  const rawTextSha256 = sha256Hex(rawBytes);
  if (rawTextSha256 !== manifest.falReceipt.providerResponseTextSha256) {
    throw new FalLineageError(
      "falReceipt.providerResponseTextSha256",
      "raw fal text digest mismatch",
    );
  }
  if (rawBytes.byteLength !== manifest.falReceipt.providerResponseUtf8ByteLength) {
    throw new FalLineageError(
      "falReceipt.providerResponseUtf8ByteLength",
      "raw fal UTF-8 byte length mismatch",
    );
  }

  const groundedValues: Array<{ path: string; grounded: GroundedValue }> = [];
  collectGroundedValues(manifest.observations, "observations", groundedValues);
  collectGroundedValues(
    manifest.crossVariantParityChecks,
    "crossVariantParityChecks",
    groundedValues,
  );

  for (const { path, grounded } of groundedValues) {
    const sourceValues = grounded.sourceRefs.map((sourceRef, refIndex) => {
      const refPath = `${path}.sourceRefs[${refIndex}]`;
      if (sourceRef.providerRequestId !== manifest.falReceipt.providerRequestId) {
        throw new FalLineageError(refPath, "provider request ID does not match receipt");
      }
      if (sourceRef.rawTextSha256 !== rawTextSha256) {
        throw new FalLineageError(refPath, "source ref raw text digest mismatch");
      }
      if (
        sourceRef.startUtf8Byte < 0 ||
        sourceRef.endUtf8Byte > rawBytes.byteLength ||
        sourceRef.endUtf8Byte <= sourceRef.startUtf8Byte
      ) {
        throw new FalLineageError(refPath, "source byte span is out of range");
      }
      const exactBytes = rawBytes.subarray(
        sourceRef.startUtf8Byte,
        sourceRef.endUtf8Byte,
      );
      const exactSourceText = exactBytes.toString("utf8");
      if (
        Buffer.byteLength(exactSourceText, "utf8") !== exactBytes.byteLength ||
        exactSourceText !== sourceRef.exactSourceText
      ) {
        throw new FalLineageError(refPath, "source span is not an exact UTF-8 excerpt");
      }
      return applyAllowedTransform(
        exactSourceText,
        sourceRef,
        grounded.value,
        refPath,
      );
    });

    assertCanonicalEqual(
      reconstructGroundedValue(sourceValues, grounded.value),
      grounded.value,
      `${path}.value`,
    );
  }

  const groundedStimulusProjectionSha256 =
    computeGroundedStimulusProjectionHash(manifest);
  const spotCheck = manifest.spotCheckReceipt;
  if (options.reusableFixtureId) {
    if (!spotCheck) {
      throw new FalLineageError(
        "spotCheckReceipt",
        "reusable fixtures require an immutable spot-check receipt",
      );
    }
    if (
      spotCheck.fixtureId !== options.reusableFixtureId ||
      spotCheck.result !== "pass"
    ) {
      throw new FalLineageError(
        "spotCheckReceipt",
        "spot-check receipt does not pass for this fixture",
      );
    }
  }

  if (spotCheck) {
    if (
      spotCheck.falProviderRequestId !== manifest.falReceipt.providerRequestId ||
      spotCheck.falRawTextSha256 !== rawTextSha256 ||
      spotCheck.groundedStimulusProjectionSha256 !==
        groundedStimulusProjectionSha256
    ) {
      throw new FalLineageError(
        "spotCheckReceipt",
        "spot-check receipt is not bound to this fal projection",
      );
    }
    if (
      canonicalizeJson(uniqueSorted(spotCheck.sourceAssetSha256s)) !==
      canonicalizeJson(uniqueSorted(manifest.falReceipt.sourceAssetSha256s))
    ) {
      throw new FalLineageError(
        "spotCheckReceipt.sourceAssetSha256s",
        "spot-check source assets do not match the fal receipt",
      );
    }
    if (computeSpotCheckReceiptHash(spotCheck) !== spotCheck.receiptSha256) {
      throw new FalLineageError(
        "spotCheckReceipt.receiptSha256",
        "spot-check receipt digest mismatch",
      );
    }
  }

  const manifestSha256 = computeTextStimulusManifestHash(manifest);
  if (manifestSha256 !== manifest.manifestSha256) {
    throw new FalLineageError("manifestSha256", "manifest digest mismatch");
  }

  return {
    manifestId: manifest.manifestId,
    providerRequestId: manifest.falReceipt.providerRequestId,
    rawTextSha256,
    groundedStimulusProjectionSha256,
    manifestSha256,
    evidenceMode: spotCheck ? "audited_demo_fixture" : "session_receipt",
    sourceRefCount: groundedValues.reduce(
      (count, item) => count + item.grounded.sourceRefs.length,
      0,
    ),
  };
}

export async function verifyGymFalLineage(
  spec: GymSpec,
  resolveFalText: FalTextResolver,
  reusableFixtureId?: string,
): Promise<VerifiedFalManifest> {
  const verified = await verifyFalManifest(spec.textStimulusManifest, resolveFalText, {
    reusableFixtureId,
  });

  const specAssetHashes = uniqueSorted(
    spec.variants.flatMap((variant) =>
      variant.assetRefs.map((asset) => asset.sha256),
    ),
  );
  const falAssetHashes = uniqueSorted(
    spec.textStimulusManifest.falReceipt.sourceAssetSha256s,
  );
  if (canonicalSha256(specAssetHashes) !== canonicalSha256(falAssetHashes)) {
    throw new FalLineageError(
      "variants.assetRefs",
      "candidate assets do not exactly match the fal receipt assets",
    );
  }

  return verified;
}
