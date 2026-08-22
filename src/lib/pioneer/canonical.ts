import { createHash } from "node:crypto";

import {
  CanonicalizationError,
  canonicalizeJson,
} from "../contracts/canonical-json";
import type { GymSpec, TextStimulusManifest } from "./schemas";

export { CanonicalizationError, canonicalizeJson };

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalizeJson(value));
}

export function computeResolvedResponseSchemaHash(
  jsonSchema: Record<string, unknown>,
): string {
  return canonicalSha256(jsonSchema);
}

export function computePedagogicalPropsHash(
  pedagogicalProps: Record<string, unknown>,
): string {
  return canonicalSha256(pedagogicalProps);
}

export function textStimulusGroundedProjection(
  manifest: TextStimulusManifest,
): Record<string, unknown> {
  return {
    manifestId: manifest.manifestId,
    manifestVersion: manifest.manifestVersion,
    falReceipt: manifest.falReceipt,
    observations: manifest.observations,
    crossVariantParityChecks: manifest.crossVariantParityChecks,
    textSource: manifest.textSource,
    normalizedBy: manifest.normalizedBy,
    normalizerVersion: manifest.normalizerVersion,
  };
}

export function computeGroundedStimulusProjectionHash(
  manifest: TextStimulusManifest,
): string {
  return canonicalSha256(textStimulusGroundedProjection(manifest));
}

export function computeSpotCheckReceiptHash(
  receipt: NonNullable<TextStimulusManifest["spotCheckReceipt"]>,
): string {
  const projection = { ...receipt } as Partial<typeof receipt>;
  delete projection.receiptSha256;
  return canonicalSha256(projection);
}

export function computeTextStimulusManifestHash(
  manifest: TextStimulusManifest,
): string {
  const projection = { ...manifest } as Partial<TextStimulusManifest>;
  delete projection.manifestSha256;
  return canonicalSha256(projection);
}

/** The exact allowlisted projection committed by gym-jcs-v1. */
export function gymContentProjection(spec: GymSpec): Record<string, unknown> {
  return {
    schemaVersion: spec.schemaVersion,
    exerciseId: spec.exerciseId,
    challengeTemplateId: spec.challengeTemplateId,
    revision: spec.revision,
    goalDefinitionId: spec.goalDefinitionId,
    episodeRole: spec.episodeRole,
    domain: spec.domain,
    subskill: spec.subskill,
    contextId: spec.contextId,
    learningObjective: spec.learningObjective,
    intendedContrast: spec.intendedContrast,
    invariants: spec.invariants,
    variants: spec.variants,
    textStimulusManifest: spec.textStimulusManifest,
    renderFrame: spec.renderFrame,
    actionMode: spec.actionMode,
    learnerPrompt: spec.learnerPrompt,
    responseContract: spec.responseContract,
    renderContracts: spec.renderContracts,
    rubric: spec.rubric,
    feedbackPlan: spec.feedbackPlan,
    retryPlan: spec.retryPlan,
    transferPlan: spec.transferPlan,
    ...(spec.transferTemplateBasis
      ? { transferTemplateBasis: spec.transferTemplateBasis }
      : {}),
    provenance: {
      authoredBy: spec.provenance.authoredBy,
      authoringPromptVersion: spec.provenance.authoringPromptVersion,
      assetManifestId: spec.provenance.assetManifestId,
      contentHashVersion: spec.provenance.contentHashVersion,
    },
  };
}

export function computeGymContentHash(spec: GymSpec): string {
  return canonicalSha256(gymContentProjection(spec));
}

function sortedAssetHashes(spec: GymSpec): string[] {
  return [
    ...new Set(
      spec.variants.flatMap((variant) =>
        variant.assetRefs.map((asset) => asset.sha256),
      ),
    ),
  ].sort();
}

export function transferComparisonProjection(
  source: GymSpec,
  transfer: GymSpec,
): Record<string, unknown> {
  return {
    comparisonVersion: "transfer-comparison-v1",
    source: {
      challengeTemplateId: source.challengeTemplateId,
      exerciseId: source.exerciseId,
      revision: source.revision,
      contentHash: source.provenance.contentHash,
      subskill: source.subskill,
      contextId: source.contextId,
      actionMode: source.actionMode,
      assetSha256s: sortedAssetHashes(source),
    },
    transfer: {
      challengeTemplateId: transfer.challengeTemplateId,
      exerciseId: transfer.exerciseId,
      revision: transfer.revision,
      contentHash: transfer.provenance.contentHash,
      subskill: transfer.subskill,
      contextId: transfer.contextId,
      actionMode: transfer.actionMode,
      assetSha256s: sortedAssetHashes(transfer),
    },
    requirements: transfer.transferTemplateBasis
      ? {
          requireSameSubskill:
            transfer.transferTemplateBasis.requireSameSubskill,
          requireChangedContext:
            transfer.transferTemplateBasis.requireChangedContext,
          requireChangedActionMode:
            transfer.transferTemplateBasis.requireChangedActionMode,
          requireDisjointStimulusAssets:
            transfer.transferTemplateBasis.requireDisjointStimulusAssets,
        }
      : null,
  };
}

export function computeTransferComparisonHash(
  source: GymSpec,
  transfer: GymSpec,
): string {
  return canonicalSha256(transferComparisonProjection(source, transfer));
}

export interface DeterministicBinding {
  bindingId: string;
  job: "validate_rep" | "recommend_next";
  schemaVersion: string;
  requestProjectionSha256: string;
}

export function createDeterministicBinding(
  job: DeterministicBinding["job"],
  schemaVersion: string,
  unboundRequest: unknown,
): DeterministicBinding {
  const requestProjectionSha256 = canonicalSha256(unboundRequest);
  const bindingDigest = canonicalSha256({
    job,
    schemaVersion,
    requestProjectionSha256,
  });
  return {
    bindingId: `bind:${bindingDigest}`,
    job,
    schemaVersion,
    requestProjectionSha256,
  };
}
