import "server-only";

import { createHash } from "node:crypto";

import { createFalClient } from "@fal-ai/client";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const falStimulusFrameSchema = z
  .object({
    variantId: z.string().trim().min(1).max(128),
    imageUrl: z.string().url().max(2_048),
    sourceAssetSha256: sha256Schema,
  })
  .strict();

export const falStimulusVisionRequestSchema = z
  .object({
    frames: z.array(falStimulusFrameSchema).min(1).max(2),
  })
  .strict();

export type FalStimulusVisionRequest = z.infer<
  typeof falStimulusVisionRequestSchema
>;

export interface FalStimulusTextFrameReceipt {
  variantId: string;
  providerRequestId: string;
  sourceAssetSha256: string;
  rawText: string;
  rawTextSha256: string;
  rawTextUtf8ByteLength: number;
}

export type FalStimulusVisionReceipt =
  | {
      mode: "live";
      provider: "fal";
      providerModelId: "perceptron/isaac-01";
      promptVersion: "pioneer-gym-vision-v1";
      frames: FalStimulusTextFrameReceipt[];
      receivedAt: string;
    }
  | {
      mode: "disabled";
      provider: "fal";
      providerModelId: "perceptron/isaac-01";
      promptVersion: "pioneer-gym-vision-v1";
      frames: [];
      disclosure: string;
    };

const FAL_VISION_ENDPOINT = "perceptron/isaac-01" as const;
const PROMPT_VERSION = "pioneer-gym-vision-v1" as const;
const MAX_RAW_TEXT_BYTES = 64 * 1_024;

const VISION_PROMPT = `Inspect this single learner-visible creative frame. Return only literal observations present in the frame. Include: exact visible copy; explicit bounding boxes; element roles when directly legible; font size, weight, and line count when observable; likely reading order; observed salience order; and technical-quality notes. Use stable element IDs and explicit coordinates. Do not infer intent, quality, audience, or pedagogy. Do not compare against an unseen variant.`;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function liveModeRequested(explicitLive: boolean) {
  return explicitLive && process.env.WORKFLOW_MODE === "live";
}

export async function obtainFalStimulusText(
  request: FalStimulusVisionRequest,
  options: { live?: boolean; timeoutMs?: number } = {},
): Promise<FalStimulusVisionReceipt> {
  const parsed = falStimulusVisionRequestSchema.parse(request);

  if (!liveModeRequested(options.live === true)) {
    return {
      mode: "disabled",
      provider: "fal",
      providerModelId: FAL_VISION_ENDPOINT,
      promptVersion: PROMPT_VERSION,
      frames: [],
      disclosure:
        "fal vision was not called. Set WORKFLOW_MODE=live and explicitly enable this stage; no fixture text is impersonated as a fal receipt.",
    };
  }

  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw new Error("FAL_KEY is required for an explicitly enabled live fal vision stage.");
  }

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 20_000, 1_000), 60_000);
  const client = createFalClient({ credentials });

  const frames = await Promise.all(
    parsed.frames.map(async (frame) => {
      const result = await client.subscribe(FAL_VISION_ENDPOINT, {
        input: {
          image_url: frame.imageUrl,
          prompt: VISION_PROMPT,
          response_style: "box",
        },
        abortSignal: AbortSignal.timeout(timeoutMs),
      });

      const rawText = result.data.output.trim();
      const rawTextUtf8ByteLength = Buffer.byteLength(rawText, "utf8");

      if (!rawText || rawTextUtf8ByteLength > MAX_RAW_TEXT_BYTES) {
        throw new Error(
          `fal response for ${frame.variantId} was empty or exceeded ${MAX_RAW_TEXT_BYTES} UTF-8 bytes.`,
        );
      }

      return {
        variantId: frame.variantId,
        providerRequestId: result.requestId,
        sourceAssetSha256: frame.sourceAssetSha256,
        rawText,
        rawTextSha256: sha256(rawText),
        rawTextUtf8ByteLength,
      };
    }),
  );

  return {
    mode: "live",
    provider: "fal",
    providerModelId: FAL_VISION_ENDPOINT,
    promptVersion: PROMPT_VERSION,
    frames,
    receivedAt: new Date().toISOString(),
  };
}
