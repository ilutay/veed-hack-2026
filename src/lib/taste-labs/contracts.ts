import { z } from "zod";

export const TASTE_LABS_FIXTURE_RUN_ID = "fixture-dotcom" as const;

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

export const TasteLabsDemoActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("topic_submitted"),
    payload: z.object({ topic: z.string().trim().min(1).max(240) }).strict(),
  }),
  z.object({
    type: z.literal("playback_ended"),
    payload: z.object({ run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID) }).strict(),
  }),
  z.object({
    type: z.literal("choice_selected"),
    payload: z
      .object({
        run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID),
        label: ChoiceLabelSchema,
        direction: z.string().trim().min(1).max(240),
      })
      .strict(),
  }),
  z.object({
    type: z.literal("taste_reaction"),
    payload: z
      .object({
        run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID),
        reaction: TasteReactionSchema,
      })
      .strict(),
  }),
]);

export type TasteLabsDemoAction = z.infer<typeof TasteLabsDemoActionSchema>;

export const PromptComposerSchema = z
  .object({
    seed_topic: z.string().max(240).optional(),
  })
  .strict();

export const LessonPlayerSchema = z
  .object({ run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID) })
  .strict();

export const NextChoicesSchema = z
  .object({ run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID) })
  .strict();

export const TasteFeedbackSchema = z
  .object({ run_id: z.literal(TASTE_LABS_FIXTURE_RUN_ID) })
  .strict();

export type PromptComposerProps = z.infer<typeof PromptComposerSchema>;
export type LessonPlayerProps = z.infer<typeof LessonPlayerSchema>;
export type NextChoicesProps = z.infer<typeof NextChoicesSchema>;
export type TasteFeedbackProps = z.infer<typeof TasteFeedbackSchema>;

export type FixtureSlide = {
  id: string;
  title: string;
  narration: string;
  duration_seconds: number;
};

export type FixtureAsset = {
  path: string;
  media_type?: string;
  provider?: string;
  slide_id?: string;
};

export type FixtureLessonScript = {
  title: string;
  learning_objective: string;
  intro?: unknown;
  slides: FixtureSlide[];
  next_video?: Array<{ label: ChoiceLabel; direction: string }>;
  sources?: Array<{
    title: string;
    url: string;
    publisher?: string;
    accessed_at?: string;
  }>;
};

export type FixtureManifest = {
  lesson_script?: string;
  timings?: TimingSegment[];
  assets?: {
    voiceover?: FixtureAsset;
    talking_head_intro?: FixtureAsset;
    slide_images?: FixtureAsset[];
  };
};

export type TimingSegment = {
  slide_id: string;
  start_seconds: number;
  end_seconds: number;
};

export type FixtureRunPayload = {
  status: "ready";
  run_id: typeof TASTE_LABS_FIXTURE_RUN_ID;
  script: FixtureLessonScript;
  manifest: FixtureManifest;
  timings: { estimated?: boolean; segments?: TimingSegment[] } | null;
};
