import { z } from "zod";

/** Taste chips — history.reactions enum from taste-profile.schema.json. */
export const TASTE_REACTIONS = [
  "too-fast",
  "too-slow",
  "too-basic",
  "too-technical",
  "more-examples",
  "less-waffle",
  "loved-the-visuals",
  "confusing-visuals",
  "nailed-it",
] as const;

export const TasteReactionSchema = z.enum(TASTE_REACTIONS);
export type TasteReaction = z.infer<typeof TasteReactionSchema>;

export const ChoiceLabelSchema = z.enum(["A", "B", "C"]);
export type ChoiceLabel = z.infer<typeof ChoiceLabelSchema>;

export const PromptComposerSchema = z
  .object({
    seed_topic: z
      .string()
      .optional()
      .describe("Optional prefill; the learner types the actual topic"),
  })
  .describe("Topic input. Dispatch topic_submitted when the learner submits.");

export const LessonPlayerSchema = z
  .object({
    run_id: z
      .string()
      .optional()
      .describe(
        "Pipeline run id. Player polls GET /api/run/[id] until artifacts exist.",
      ),
    runBase: z
      .string()
      .optional()
      .describe(
        "Direct run-root URL if the client already has one. Never a generated video_url.",
      ),
  })
  .refine((v) => Boolean(v.run_id || v.runBase), {
    message: "LessonPlayer needs run_id or runBase",
  })
  .describe(
    "Plays a lesson from a run id. Fetches script/manifest; never takes a video_url.",
  );

export const NextChoicesSchema = z
  .object({
    run_id: z
      .string()
      .describe("Run whose lesson-script next_video (A/B/C) to render"),
  })
  .describe(
    "A/B/C next-topic cards. Loads copy from the run; props are the run id.",
  );

export const TasteFeedbackSchema = z
  .object({
    run_id: z.string().describe("Completed lesson run to attach reactions to"),
  })
  .describe(
    "Reaction chips from the taste-profile enum. Props are the run id.",
  );

export const ProfileGateSchema = z
  .object({})
  .describe(
    "Show on boot when no learner profile is in localStorage. Name field; POST /api/profile then dispatch profile_entered.",
  );

export const InterestSurveySchema = z
  .object({
    slug: z
      .string()
      .describe("Learner profile slug to POST interests against"),
  })
  .describe(
    "Show when a new profile needs an interest survey. Dispatch interests_submitted after POST.",
  );

export const LevelQuizSchema = z
  .object({
    slug: z
      .string()
      .describe(
        "Learner profile slug. Polls GET /api/profile/:slug until quiz questions exist.",
      ),
  })
  .describe(
    "Show after interests are submitted. Fetches the level quiz; never takes correct answers as props.",
  );

export const RecommendedTopicsSchema = z
  .object({
    slug: z
      .string()
      .describe(
        "Learner profile slug. Reads recommended_topics from the profile.",
      ),
  })
  .describe(
    "Show when onboarding is complete. Click a topic to dispatch recommendation_selected.",
  );

export type PromptComposerProps = z.infer<typeof PromptComposerSchema>;
export type LessonPlayerProps = z.infer<typeof LessonPlayerSchema>;
export type NextChoicesProps = z.infer<typeof NextChoicesSchema>;
export type TasteFeedbackProps = z.infer<typeof TasteFeedbackSchema>;
export type ProfileGateProps = z.infer<typeof ProfileGateSchema>;
export type InterestSurveyProps = z.infer<typeof InterestSurveySchema>;
export type LevelQuizProps = z.infer<typeof LevelQuizSchema>;
export type RecommendedTopicsProps = z.infer<typeof RecommendedTopicsSchema>;
