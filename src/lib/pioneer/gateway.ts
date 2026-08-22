import { z } from "zod";

import {
  canonicalizeJson,
  computeGymContentHash,
  computePedagogicalPropsHash,
  computeResolvedResponseSchemaHash,
  computeSpotCheckReceiptHash,
  computeTextStimulusManifestHash,
  computeTransferComparisonHash,
  createDeterministicBinding,
  sha256Hex,
} from "./canonical";
import {
  type FalTextResolver,
  verifyFalSourceRefs,
  verifyGymFalLineage,
} from "./fal-lineage";
import {
  NextChallengeRecommendationSchema,
  P1_SCHEMA_VERSION,
  P2_SCHEMA_VERSION,
  PIONEER_CONTRACT_VERSION,
  RecommendNextInputSchema,
  RecommendNextRequestSchema,
  ValidateExerciseInputSchema,
  ValidateExerciseRequestSchema,
  ValidateExerciseResponseSchema,
  type EligibleChallengeMetadata,
  type NextChallengeRecommendation,
  type RecommendNextInput,
  type RecommendNextRequest,
  type ValidateExerciseInput,
  type ValidateExerciseRequest,
  type ValidateExerciseResponse,
} from "./schemas";

export const PIONEER_API_ENDPOINT =
  "https://api.pioneer.ai/v1/chat/completions" as const;
export const PIONEER_DEADLINE_MS = 4_000 as const;
export const P1_MAX_UTF8_BYTES = 32_768 as const;
export const P1_MAX_TOKENS = 8_000 as const;
export const P2_MAX_UTF8_BYTES = 24_576 as const;
export const P2_MAX_TOKENS = 6_000 as const;
export const PIONEER_MAX_RESPONSE_UTF8_BYTES = 65_536 as const;

export type PioneerJob = "validate_rep" | "recommend_next";
export type WorkflowMode = "dry-run" | "test" | "live";

export type PioneerGatewayErrorCode =
  | "invalid_input"
  | "integrity_failure"
  | "forbidden_content"
  | "request_too_large";

export class PioneerGatewayError extends Error {
  readonly code: PioneerGatewayErrorCode;
  readonly causeValue?: unknown;

  constructor(
    code: PioneerGatewayErrorCode,
    message: string,
    causeValue?: unknown,
  ) {
    super(message);
    this.name = "PioneerGatewayError";
    this.code = code;
    this.causeValue = causeValue;
  }
}

export interface PioneerTransportReceipt {
  requestId: string;
  bindingId: string;
  job: PioneerJob;
  exactRequestSha256: string;
  requestUtf8ByteLength: number;
  tokenizerId: string;
  requestTokenCount: number;
  textParts: 1;
  multimodalParts: 0;
  toolCount: 0;
  persistedAt: string;
}

export interface PioneerTransportRecord {
  receipt: PioneerTransportReceipt;
  exactRequestText: string;
  exactResponseText?: string;
  status:
    | "prepared"
    | "live_complete"
    | "fallback"
    | "timeout"
    | "transport_error"
    | "invalid_response";
  fallbackReason?: PioneerFallbackReason;
}

export type PioneerFallbackReason =
  | "dry_run"
  | "test_transport_missing"
  | "missing_api_key"
  | "missing_model"
  | "fal_lineage_unavailable"
  | "fal_lineage_invalid"
  | "timeout"
  | "transport_error"
  | "invalid_response"
  | "binding_mismatch";

export interface ValidateRepFallback {
  source: "deterministic_fallback";
  job: "validate_rep";
  judgment: "ABSTAIN";
  action: "use_prevalidated_fixture_or_block";
  reason: PioneerFallbackReason;
  disclosure: string;
}

export interface RecommendNextFallback {
  source: "deterministic_fallback";
  job: "recommend_next";
  action: "use_prevalidated_fixture" | "block";
  reason: PioneerFallbackReason;
  recommendedChallengeTemplateId?: string;
  recommendedEpisodeRole?:
    | "diagnostic_probe"
    | "retry"
    | "held_out_transfer";
  disclosure: string;
}

export interface PioneerLiveResult<T> {
  kind: "live";
  response: T;
  receipt: PioneerTransportReceipt;
}

export interface PioneerFallbackResult<T> {
  kind: "fallback";
  fallback: T;
  receipt: PioneerTransportReceipt;
}

export type ValidateExerciseResult =
  | PioneerLiveResult<ValidateExerciseResponse>
  | PioneerFallbackResult<ValidateRepFallback>;

export type RecommendNextResult =
  | PioneerLiveResult<NextChallengeRecommendation>
  | PioneerFallbackResult<RecommendNextFallback>;

export interface TokenCount {
  count: number;
  tokenizerId: string;
}

export type TokenCounter = (text: string, model: string) => TokenCount;

export interface PioneerTextGatewayConfig {
  apiKey?: string;
  model?: string;
  workflowMode?: WorkflowMode;
  fetchImpl?: typeof fetch;
  resolveFalText?: FalTextResolver;
  countTokens?: TokenCounter;
  now?: () => Date;
}

interface ResolvedGatewayConfig {
  apiKey: string | undefined;
  model: string | undefined;
  workflowMode: WorkflowMode;
  fetchImpl: typeof fetch;
  hasInjectedFetch: boolean;
  resolveFalText: FalTextResolver | undefined;
  countTokens: TokenCounter;
  now: () => Date;
}

const OpenAiCompatibleResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z
                  .string()
                  .min(1)
                  .max(PIONEER_MAX_RESPONSE_UTF8_BYTES),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .length(1),
  })
  .passthrough();

const FORBIDDEN_KEY = /^(?:url|uri|href|src|file|filename|attachment|image|audio|video|base64|blob|tool|tools|tool_call|tool_calls|tool_choice)$/i;
const FORBIDDEN_KEY_SUFFIX = /(?:Url|Uri)$/;
const URL_OR_DATA_URI = /(?:https?:\/\/|file:\/\/|blob:|data:[^,;]+;base64,|\bwww\.)/i;
const LONG_BASE64 = /^(?:[A-Za-z0-9+/]{4}){32,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function assertTextOnlyJson(value: unknown, path = "request"): void {
  if (typeof value === "string") {
    if (URL_OR_DATA_URI.test(value)) {
      throw new PioneerGatewayError(
        "forbidden_content",
        `${path} contains a URL or data URI; Pioneer only receives bounded text evidence`,
      );
    }
    if (value.length >= 128 && LONG_BASE64.test(value)) {
      throw new PioneerGatewayError(
        "forbidden_content",
        `${path} appears to contain base64 media or binary data`,
      );
    }
    return;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertTextOnlyJson(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    throw new PioneerGatewayError(
      "forbidden_content",
      `${path} is not JSON text data`,
    );
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new PioneerGatewayError(
      "forbidden_content",
      `${path} contains binary data`,
    );
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) || FORBIDDEN_KEY_SUFFIX.test(key)) {
      throw new PioneerGatewayError(
        "forbidden_content",
        `${path}.${key} is a forbidden retrievable or multimodal field`,
      );
    }
    assertTextOnlyJson(entry, `${path}.${key}`);
  }
}

function deterministicTokenCount(text: string, model: string): TokenCount {
  // Pinned, deterministic application bound. The injected production counter
  // can replace this with the locked model tokenizer without changing receipts.
  return {
    count: Math.ceil(Buffer.byteLength(text, "utf8") / 3),
    tokenizerId: `pioneer:${model}:utf8-triplet-v1`,
  };
}

function resolveWorkflowMode(value: string | undefined): WorkflowMode {
  if (value === "live" || value === "test") return value;
  return "dry-run";
}

function resolveConfig(config: PioneerTextGatewayConfig): ResolvedGatewayConfig {
  const hasApiKey = Object.prototype.hasOwnProperty.call(config, "apiKey");
  const hasModel = Object.prototype.hasOwnProperty.call(config, "model");
  return {
    apiKey: hasApiKey ? config.apiKey || undefined : process.env.PIONEER_API_KEY,
    model: hasModel ? config.model || undefined : process.env.PIONEER_MODEL,
    workflowMode:
      config.workflowMode ?? resolveWorkflowMode(process.env.WORKFLOW_MODE),
    fetchImpl: config.fetchImpl ?? globalThis.fetch,
    hasInjectedFetch: Boolean(config.fetchImpl),
    resolveFalText: config.resolveFalText,
    countTokens: config.countTokens ?? deterministicTokenCount,
    now: config.now ?? (() => new Date()),
  };
}

function configurationFallbackReason(
  config: ResolvedGatewayConfig,
): PioneerFallbackReason | null {
  if (config.workflowMode === "dry-run") return "dry_run";
  if (config.workflowMode === "test" && !config.hasInjectedFetch) {
    return "test_transport_missing";
  }
  if (!config.apiKey) return "missing_api_key";
  if (!config.model) return "missing_model";
  return null;
}

function validateIntegrity(request: ValidateExerciseRequest): void {
  const candidate = request.candidate;
  const manifest = candidate.textStimulusManifest;
  if (computeTextStimulusManifestHash(manifest) !== manifest.manifestSha256) {
    throw new PioneerGatewayError(
      "integrity_failure",
      "candidate fal text manifest digest does not match",
    );
  }
  if (manifest.spotCheckReceipt) {
    if (manifest.spotCheckReceipt.result !== "pass") {
      throw new PioneerGatewayError(
        "integrity_failure",
        "a failed spot-check receipt makes the fixture unusable",
      );
    }
    if (
      computeSpotCheckReceiptHash(manifest.spotCheckReceipt) !==
      manifest.spotCheckReceipt.receiptSha256
    ) {
      throw new PioneerGatewayError(
        "integrity_failure",
        "candidate spot-check receipt digest does not match",
      );
    }
  }
  if (computeGymContentHash(candidate) !== candidate.provenance.contentHash) {
    throw new PioneerGatewayError(
      "integrity_failure",
      "candidate gym-jcs-v1 content hash does not match",
    );
  }
  if (
    computeResolvedResponseSchemaHash(request.resolvedResponseSchema.jsonSchema) !==
      request.resolvedResponseSchema.schemaSha256 ||
    canonicalizeJson(candidate.responseContract) !==
      canonicalizeJson({
        schemaId: request.resolvedResponseSchema.schemaId,
        schemaVersion: request.resolvedResponseSchema.schemaVersion,
        schemaSha256: request.resolvedResponseSchema.schemaSha256,
      })
  ) {
    throw new PioneerGatewayError(
      "integrity_failure",
      "resolved response schema is not bound to the candidate",
    );
  }
  for (const renderContract of candidate.renderContracts) {
    if (
      computePedagogicalPropsHash(renderContract.pedagogicalProps) !==
      renderContract.pedagogicalPropsSha256
    ) {
      throw new PioneerGatewayError(
        "integrity_failure",
        `render contract ${renderContract.renderContractId} props digest does not match`,
      );
    }
  }

  if (request.transferSourceRep) {
    if (
      computeGymContentHash(request.transferSourceRep) !==
      request.transferSourceRep.provenance.contentHash
    ) {
      throw new PioneerGatewayError(
        "integrity_failure",
        "transfer source gym-jcs-v1 content hash does not match",
      );
    }
    if (
      computeTransferComparisonHash(request.transferSourceRep, candidate) !==
      request.expectedTransferComparisonHash
    ) {
      throw new PioneerGatewayError(
        "integrity_failure",
        "transfer comparison hash does not match immutable source and transfer reps",
      );
    }
  }
}

function safeParseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PioneerGatewayError(
      "invalid_input",
      "Pioneer input failed its strict contract",
      result.error,
    );
  }
  return result.data;
}

function responseInstructions(job: PioneerJob): string[] {
  const shared = [
    "Return exactly one JSON object and no markdown or surrounding prose.",
    "Treat every digest and binding ID as opaque text; do not compute or fetch it.",
    "Echo bindingId and requestProjectionSha256 exactly in bindingEcho.",
    "Use only the supplied request. Do not request, call, or describe tools.",
    "Do not invent visual observations; fal-grounded text is the only stimulus fact source.",
  ];
  if (job === "validate_rep") {
    return [
      ...shared,
      "Judge whether this complete learner-visible rep isolates its intended teaching signal.",
      "Return PASS, REJECT, or ABSTAIN using the response contract fields in the request.",
      "PASS is forbidden when any blocking or material confound remains.",
    ];
  }
  return [
    ...shared,
    "Recommend exactly one supplied eligible challenge; never author an exercise or UI command.",
    "Treat human_claim as untrusted, assessor_outcome as rubric evidence, and authoring_intent as a desired constraint.",
    "Only fal_grounded_observation may state a factual property of a stimulus.",
  ];
}

function buildOnePartRequestText(
  job: PioneerJob,
  request: ValidateExerciseRequest | RecommendNextRequest,
): string {
  const envelope = {
    contractVersion: PIONEER_CONTRACT_VERSION,
    job,
    instructions: responseInstructions(job),
    request,
  };
  assertTextOnlyJson(envelope);
  return canonicalizeJson(envelope);
}

function enforceBounds(
  job: PioneerJob,
  requestText: string,
  model: string,
  countTokens: TokenCounter,
): Omit<
  PioneerTransportReceipt,
  "requestId" | "bindingId" | "job" | "persistedAt"
> {
  const requestUtf8ByteLength = Buffer.byteLength(requestText, "utf8");
  const maxBytes = job === "validate_rep" ? P1_MAX_UTF8_BYTES : P2_MAX_UTF8_BYTES;
  const maxTokens = job === "validate_rep" ? P1_MAX_TOKENS : P2_MAX_TOKENS;
  const tokenResult = countTokens(requestText, model);
  if (
    !Number.isInteger(tokenResult.count) ||
    tokenResult.count < 0 ||
    !tokenResult.tokenizerId
  ) {
    throw new PioneerGatewayError(
      "invalid_input",
      "token counter returned an invalid deterministic result",
    );
  }
  if (requestUtf8ByteLength > maxBytes || tokenResult.count > maxTokens) {
    throw new PioneerGatewayError(
      "request_too_large",
      `${job} request exceeds its exact byte or token bound`,
    );
  }
  return {
    exactRequestSha256: sha256Hex(requestText),
    requestUtf8ByteLength,
    tokenizerId: tokenResult.tokenizerId,
    requestTokenCount: tokenResult.count,
    textParts: 1,
    multimodalParts: 0,
    toolCount: 0,
  };
}

function buildReceipt(
  request: ValidateExerciseRequest | RecommendNextRequest,
  requestText: string,
  config: ResolvedGatewayConfig,
): PioneerTransportReceipt {
  const bounds = enforceBounds(
    request.binding.job,
    requestText,
    config.model ?? "unconfigured",
    config.countTokens,
  );
  return {
    requestId: request.requestId,
    bindingId: request.binding.bindingId,
    job: request.binding.job,
    ...bounds,
    persistedAt: config.now().toISOString(),
  };
}

function makeValidateFallback(
  reason: PioneerFallbackReason,
): ValidateRepFallback {
  return {
    source: "deterministic_fallback",
    job: "validate_rep",
    judgment: "ABSTAIN",
    action: "use_prevalidated_fixture_or_block",
    reason,
    disclosure:
      "No live Pioneer validation was produced. Use an independently prevalidated fixture or block this rep.",
  };
}

function chooseFallbackChallenge(
  eligibleChallenges: EligibleChallengeMetadata[],
  maxEstimatedSeconds: number,
): EligibleChallengeMetadata | undefined {
  return [...eligibleChallenges]
    .filter(
      (challenge) =>
        challenge.prevalidatedSpec &&
        challenge.estimatedSeconds <= maxEstimatedSeconds,
    )
    .sort((left, right) =>
      left.challengeTemplateId.localeCompare(right.challengeTemplateId),
    )[0];
}

function makeRecommendFallback(
  reason: PioneerFallbackReason,
  request: RecommendNextRequest,
): RecommendNextFallback {
  const challenge = chooseFallbackChallenge(
    request.eligibleChallenges,
    request.maxEstimatedSeconds,
  );
  return challenge
    ? {
        source: "deterministic_fallback",
        job: "recommend_next",
        action: "use_prevalidated_fixture",
        reason,
        recommendedChallengeTemplateId: challenge.challengeTemplateId,
        recommendedEpisodeRole: challenge.allowedEpisodeRoles[0],
        disclosure:
          "This is a deterministic prevalidated-fixture fallback, not a live Pioneer recommendation.",
      }
    : {
        source: "deterministic_fallback",
        job: "recommend_next",
        action: "block",
        reason,
        disclosure:
          "No live Pioneer recommendation or eligible prevalidated fallback is available.",
      };
}

function parseStrictJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Pioneer returned non-JSON text");
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error("Pioneer transport returned an empty response body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > PIONEER_MAX_RESPONSE_UTF8_BYTES) {
        await reader.cancel();
        throw new Error("Pioneer response exceeds its UTF-8 byte bound");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

async function invokePioneer(
  requestText: string,
  config: ResolvedGatewayConfig,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PIONEER_DEADLINE_MS);
  timeout.unref?.();
  try {
    const response = await config.fetchImpl(PIONEER_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey!,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        stream: false,
        messages: [{ role: "user", content: requestText }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Pioneer transport returned HTTP ${response.status}`);
    }
    const completion = OpenAiCompatibleResponseSchema.parse(
      parseStrictJson(await readBoundedResponseText(response)),
    );
    return completion.choices[0].message.content;
  } finally {
    clearTimeout(timeout);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function validateEcho(
  expected: ValidateExerciseRequest["binding"] | RecommendNextRequest["binding"],
  actual: { bindingId: string; requestProjectionSha256: string },
): boolean {
  return (
    expected.bindingId === actual.bindingId &&
    expected.requestProjectionSha256 === actual.requestProjectionSha256
  );
}

function validateP1Semantics(
  request: ValidateExerciseRequest,
  response: ValidateExerciseResponse,
  model: string,
): boolean {
  const candidate = request.candidate;
  if (
    !validateEcho(request.binding, response.bindingEcho) ||
    response.requestId !== request.requestId ||
    response.exerciseId !== candidate.exerciseId ||
    response.exerciseRevision !== candidate.revision ||
    canonicalizeJson(response.scope) !== canonicalizeJson(request.scope) ||
    response.goalDefinitionId !== candidate.goalDefinitionId ||
    response.candidateContentHash !== candidate.provenance.contentHash ||
    response.modelVersion !== model ||
    response.transferComparisonHash !== request.expectedTransferComparisonHash
  ) {
    return false;
  }
  if (
    response.judgment === "PASS" &&
    (response.intendedTeachingSignal !== candidate.learningObjective ||
      candidate.textStimulusManifest.crossVariantParityChecks.some(
        (check) => check.status.value === "unverified",
      ))
  ) {
    return false;
  }
  return true;
}

function authoringTexts(
  items: RecommendNextRequest["eligibleChallenges"][number][
    | "preserve"
    | "vary"
    | "removeShortcuts"
  ],
): string[] {
  return items.map((item) => item.text);
}

function validateP2Semantics(
  request: RecommendNextRequest,
  response: NextChallengeRecommendation,
  model: string,
): boolean {
  if (
    !validateEcho(request.binding, response.bindingEcho) ||
    response.requestId !== request.requestId ||
    response.modelVersion !== model
  ) {
    return false;
  }
  const selected = request.eligibleChallenges.find(
    (challenge) =>
      challenge.challengeTemplateId === response.recommendedChallengeTemplateId,
  );
  if (
    !selected ||
    selected.estimatedSeconds > request.maxEstimatedSeconds ||
    selected.subskill !== response.recommendedSubskill ||
    selected.actionMode !== response.recommendedActionMode ||
    selected.difficulty !== response.challengeProfile.targetDifficulty ||
    !selected.allowedEpisodeRoles.includes(response.episodeRole) ||
    canonicalizeJson(authoringTexts(selected.preserve)) !==
      canonicalizeJson(response.challengeProfile.preserve) ||
    canonicalizeJson(authoringTexts(selected.vary)) !==
      canonicalizeJson(response.challengeProfile.vary) ||
    canonicalizeJson(authoringTexts(selected.removeShortcuts)) !==
      canonicalizeJson(response.challengeProfile.removeShortcuts)
  ) {
    return false;
  }
  const validEvidenceIds = new Set(
    request.latestEvidence.map((evidence) => evidence.evidenceId),
  );
  return response.evidenceIds.every((evidenceId) => validEvidenceIds.has(evidenceId));
}

async function verifyP2FalLineage(
  request: RecommendNextRequest,
  resolveFalText: FalTextResolver,
): Promise<void> {
  for (const [evidenceIndex, evidence] of request.latestEvidence.entries()) {
    for (const [textIndex, text] of evidence.texts.entries()) {
      const path = `latestEvidence[${evidenceIndex}].texts[${textIndex}]`;
      if (text.textClass === "fal_grounded_observation") {
        await verifyFalSourceRefs(text.sourceRefs, resolveFalText, {
          expectedValue: text.text,
          path: `${path}.sourceRefs`,
        });
      } else if (text.textClass === "assessor_outcome" && text.falSourceRefs) {
        await verifyFalSourceRefs(text.falSourceRefs, resolveFalText, {
          path: `${path}.falSourceRefs`,
        });
      }
    }
  }
}

export interface PioneerTextGateway {
  validateExercise(input: ValidateExerciseInput): Promise<ValidateExerciseResult>;
  recommendNext(input: RecommendNextInput): Promise<RecommendNextResult>;
  getTransportRecord(requestId: string): PioneerTransportRecord | undefined;
}

export function createPioneerTextGateway(
  inputConfig: PioneerTextGatewayConfig = {},
): PioneerTextGateway {
  const records = new Map<string, PioneerTransportRecord>();

  return {
    async validateExercise(
      rawInput: ValidateExerciseInput,
    ): Promise<ValidateExerciseResult> {
      const config = resolveConfig(inputConfig);
      const input = safeParseInput(ValidateExerciseInputSchema, rawInput);
      const binding = createDeterministicBinding(
        "validate_rep",
        P1_SCHEMA_VERSION,
        input,
      );
      const request = safeParseInput(ValidateExerciseRequestSchema, {
        ...input,
        binding,
      });
      validateIntegrity(request);
      assertTextOnlyJson(request);
      const requestText = buildOnePartRequestText("validate_rep", request);
      const receipt = buildReceipt(request, requestText, config);
      records.set(request.requestId, {
        receipt,
        exactRequestText: requestText,
        status: "prepared",
      });

      const configReason = configurationFallbackReason(config);
      if (configReason) {
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: configReason,
        });
        return {
          kind: "fallback",
          fallback: makeValidateFallback(configReason),
          receipt,
        };
      }
      if (!config.resolveFalText) {
        const reason = "fal_lineage_unavailable" as const;
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeValidateFallback(reason),
          receipt,
        };
      }
      try {
        await verifyGymFalLineage(
          request.candidate,
          config.resolveFalText,
          request.scope.kind === "reusable_fixture"
            ? request.scope.fixtureId
            : undefined,
        );
        if (request.transferSourceRep) {
          await verifyGymFalLineage(
            request.transferSourceRep,
            config.resolveFalText,
          );
        }
      } catch {
        const reason = "fal_lineage_invalid" as const;
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeValidateFallback(reason),
          receipt,
        };
      }

      try {
        const responseText = await invokePioneer(requestText, config);
        const parsed = ValidateExerciseResponseSchema.safeParse(
          parseStrictJson(responseText),
        );
        if (!parsed.success || !validateP1Semantics(request, parsed.data, config.model!)) {
          const reason = parsed.success
            ? ("binding_mismatch" as const)
            : ("invalid_response" as const);
          records.set(request.requestId, {
            receipt,
            exactRequestText: requestText,
            exactResponseText: responseText,
            status: "invalid_response",
            fallbackReason: reason,
          });
          return {
            kind: "fallback",
            fallback: makeValidateFallback(reason),
            receipt,
          };
        }
        assertTextOnlyJson(parsed.data, "response");
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          exactResponseText: responseText,
          status: "live_complete",
        });
        return { kind: "live", response: parsed.data, receipt };
      } catch (error) {
        const reason = isAbortError(error)
          ? ("timeout" as const)
          : ("transport_error" as const);
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: reason,
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeValidateFallback(reason),
          receipt,
        };
      }
    },

    async recommendNext(rawInput: RecommendNextInput): Promise<RecommendNextResult> {
      const config = resolveConfig(inputConfig);
      const input = safeParseInput(RecommendNextInputSchema, rawInput);
      assertTextOnlyJson(input);
      const binding = createDeterministicBinding(
        "recommend_next",
        P2_SCHEMA_VERSION,
        input,
      );
      const request = safeParseInput(RecommendNextRequestSchema, {
        ...input,
        binding,
      });
      const requestText = buildOnePartRequestText("recommend_next", request);
      const receipt = buildReceipt(request, requestText, config);
      records.set(request.requestId, {
        receipt,
        exactRequestText: requestText,
        status: "prepared",
      });

      const configReason = configurationFallbackReason(config);
      if (configReason) {
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: configReason,
        });
        return {
          kind: "fallback",
          fallback: makeRecommendFallback(configReason, request),
          receipt,
        };
      }
      if (!config.resolveFalText) {
        const reason = "fal_lineage_unavailable" as const;
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeRecommendFallback(reason, request),
          receipt,
        };
      }
      try {
        await verifyP2FalLineage(request, config.resolveFalText);
      } catch {
        const reason = "fal_lineage_invalid" as const;
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: "fallback",
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeRecommendFallback(reason, request),
          receipt,
        };
      }

      try {
        const responseText = await invokePioneer(requestText, config);
        const parsed = NextChallengeRecommendationSchema.safeParse(
          parseStrictJson(responseText),
        );
        if (!parsed.success || !validateP2Semantics(request, parsed.data, config.model!)) {
          const reason = parsed.success
            ? ("binding_mismatch" as const)
            : ("invalid_response" as const);
          records.set(request.requestId, {
            receipt,
            exactRequestText: requestText,
            exactResponseText: responseText,
            status: "invalid_response",
            fallbackReason: reason,
          });
          return {
            kind: "fallback",
            fallback: makeRecommendFallback(reason, request),
            receipt,
          };
        }
        assertTextOnlyJson(parsed.data, "response");
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          exactResponseText: responseText,
          status: "live_complete",
        });
        return { kind: "live", response: parsed.data, receipt };
      } catch (error) {
        const reason = isAbortError(error)
          ? ("timeout" as const)
          : ("transport_error" as const);
        records.set(request.requestId, {
          receipt,
          exactRequestText: requestText,
          status: reason,
          fallbackReason: reason,
        });
        return {
          kind: "fallback",
          fallback: makeRecommendFallback(reason, request),
          receipt,
        };
      }
    },

    getTransportRecord(requestId: string): PioneerTransportRecord | undefined {
      return records.get(requestId);
    },
  };
}

const defaultGateway = createPioneerTextGateway();

export async function validateExercise(
  input: ValidateExerciseInput,
): Promise<ValidateExerciseResult> {
  return defaultGateway.validateExercise(input);
}

export async function recommendNext(
  input: RecommendNextInput,
): Promise<RecommendNextResult> {
  return defaultGateway.recommendNext(input);
}
