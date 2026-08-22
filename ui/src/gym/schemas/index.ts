import { z } from "zod";

/**
 * Props schemas for every gym component Codex is allowed to render.
 *
 * These are the contract between Codex (which produces a component block) and
 * the client (which renders it). ComponentRenderer validates incoming props
 * against these via the Standard Schema interface that zod@4 implements.
 *
 * Keep props small and declarative: Codex generates them token by token, so a
 * fat schema is a slow turn. Never put a value here the model would have to
 * invent — pass an id and let the component fetch.
 */

/** Shared shape for a single answer option inside a probe. */
export const ProbeChoiceSchema = z.object({
  id: z.string().describe("Stable id echoed back in the emitted event"),
  label: z.string().describe("Answer text shown to the learner"),
});

export const ProbeArenaSchema = z
  .object({
    probeId: z.string().describe("Pioneer probe identifier"),
    prompt: z.string().describe("The diagnostic question posed to the learner"),
    choices: z
      .array(ProbeChoiceSchema)
      .min(2)
      .describe("Two or more answer options"),
    skill: z.string().describe("Skill tag this probe measures"),
  })
  .describe("A Pioneer-certified diagnostic exercise");

export const EvidenceSpanSchema = z.object({
  start: z.number().int().nonnegative().describe("Inclusive start offset into responseText"),
  end: z.number().int().nonnegative().describe("Exclusive end offset into responseText"),
  verdict: z.enum(["credit", "blame", "neutral"]).describe("How this span moved the score"),
  note: z.string().describe("Why this span earned its verdict"),
});

export const CreditAssignmentReplaySchema = z
  .object({
    probeId: z.string().describe("Probe this replay explains"),
    responseText: z.string().describe("The learner's response, verbatim"),
    spans: z
      .array(EvidenceSpanSchema)
      .describe("Evidence spans grounding the feedback in the response"),
    score: z.number().min(0).max(1).describe("Normalised score for the attempt"),
  })
  .describe("Visual feedback grounded in response evidence");

export const TargetedRetryGymSchema = z
  .object({
    probeId: z.string().describe("Probe being retried"),
    skill: z.string().describe("Skill the retry drills"),
    hint: z.string().describe("Scaffolding shown before the retry"),
    attemptsRemaining: z
      .number()
      .int()
      .min(0)
      .describe("How many retries the learner has left"),
  })
  .describe("A scaffolded retry aimed at one failed skill");

export const LayerOrderTransferGymSchema = z
  .object({
    taskId: z.string().describe("Transfer task identifier"),
    instruction: z.string().describe("What the learner must order and why"),
    layers: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .min(2)
      .describe("Layers presented in scrambled order"),
  })
  .describe("Tests whether a learned ordering transfers to a new surface");

export const LessonVideoSchema = z
  .object({
    jobId: z
      .string()
      .describe("Lesson render job id returned by the bridge; never invent one"),
    title: z.string().describe("Lesson title shown above the player"),
  })
  .describe("A lesson video being rendered offline, polled until it is playable");

export type ProbeArenaProps = z.infer<typeof ProbeArenaSchema>;
export type CreditAssignmentReplayProps = z.infer<typeof CreditAssignmentReplaySchema>;
export type TargetedRetryGymProps = z.infer<typeof TargetedRetryGymSchema>;
export type LayerOrderTransferGymProps = z.infer<typeof LayerOrderTransferGymSchema>;
export type LessonVideoProps = z.infer<typeof LessonVideoSchema>;
