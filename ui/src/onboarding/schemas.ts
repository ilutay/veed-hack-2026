import { z } from "zod";

/**
 * Props schemas for the onboarding and lesson-loop surfaces.
 *
 * Same rule as the gym schemas: props are ids and seeds, never content the
 * model would have to invent. The components read the learner profile from
 * ProfileProvider, so most of these carry almost nothing.
 */

export const ProfileGateSchema = z
  .object({})
  .describe("Show on boot when no learner profile is active. Asks for a name.");

export const InterestSurveySchema = z
  .object({
    slug: z.string().describe("Learner profile slug the interests belong to"),
  })
  .describe("Show when a new profile needs its interest survey.");

export const LevelQuizSchema = z
  .object({
    slug: z.string().describe("Learner profile slug; the quiz is built from its interests"),
  })
  .describe("Show after interests are submitted. Placement quiz; never carries answers.");

export const RecommendedTopicsSchema = z
  .object({
    slug: z.string().describe("Learner profile slug; reads recommended_topics from it"),
  })
  .describe("Show when onboarding is complete. Topic cards pitched at the learner's level.");

export const PromptComposerSchema = z
  .object({
    seed_topic: z.string().optional().describe("Optional prefill; the learner types the topic"),
  })
  .describe("Topic input. Show when the learner should type what to learn next.");

export const NextChoicesSchema = z
  .object({
    jobId: z.string().describe("The finished lesson job the choices follow"),
    topic: z.string().describe("Topic of that lesson; directions are derived from it"),
  })
  .describe("A/B/C follow-up directions shown after a lesson has played.");

export const TasteFeedbackSchema = z
  .object({
    jobId: z.string().describe("Finished lesson job the reaction is attached to"),
  })
  .describe("Reaction chips for a finished lesson; nudges the taste profile.");

export type ProfileGateProps = z.infer<typeof ProfileGateSchema>;
export type InterestSurveyProps = z.infer<typeof InterestSurveySchema>;
export type LevelQuizProps = z.infer<typeof LevelQuizSchema>;
export type RecommendedTopicsProps = z.infer<typeof RecommendedTopicsSchema>;
export type PromptComposerProps = z.infer<typeof PromptComposerSchema>;
export type NextChoicesProps = z.infer<typeof NextChoicesSchema>;
export type TasteFeedbackProps = z.infer<typeof TasteFeedbackSchema>;

export const StartLessonSchema = z
  .object({
    topic: z.string().describe("Concrete lesson title to render, phrased for the learner's level"),
    reason: z.string().optional().describe("One short sentence on why this lesson now"),
  })
  .describe("Starts a lesson render on a topic the learner named or clearly implied. Never without a topic.");

export const AgentNoteSchema = z
  .object({
    text: z.string().describe("A short, helpful reply to the learner"),
  })
  .describe("A plain reply when no surface is needed: questions, preferences, feedback, small talk.");

export type StartLessonProps = z.infer<typeof StartLessonSchema>;
export type AgentNoteProps = z.infer<typeof AgentNoteSchema>;
