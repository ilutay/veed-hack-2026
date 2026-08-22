/**
 * The small amount of onboarding logic that stays in the browser. Scoring,
 * placement, research and recommendations all happen on the bridge (Tavily +
 * Codex); this is labels, slugs and the follow-up directions after a lesson.
 */

export const SUGGESTED_INTERESTS = [
  "the dot-com bubble",
  "compound interest",
  "how the internet works",
  "probability",
  "climate science",
] as const;

export const MAX_INTERESTS = 5;

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
export type TasteReaction = (typeof TASTE_REACTIONS)[number];

export const TASTE_LABELS: Record<TasteReaction, string> = {
  "too-fast": "Too fast",
  "too-slow": "Too slow",
  "too-basic": "Too basic",
  "too-technical": "Too technical",
  "more-examples": "More examples",
  "less-waffle": "Less waffle",
  "loved-the-visuals": "Loved the visuals",
  "confusing-visuals": "Confusing visuals",
  "nailed-it": "Nailed it",
};

/** Mirrors the bridge's slug rule so the gate can validate before posting. */
export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type ChoiceLabel = "A" | "B" | "C";
export type NextDirection = {
  label: ChoiceLabel;
  kind: "deeper" | "wider" | "applied";
  topic: string;
};

/** The A/B/C follow-ups offered once a lesson has played. */
export function nextDirectionsFor(topic: string): NextDirection[] {
  const t = topic.trim();
  return [
    { label: "A", kind: "deeper", topic: `How ${t} actually works, step by step` },
    { label: "B", kind: "wider", topic: `What sits around ${t}: context and related ideas` },
    { label: "C", kind: "applied", topic: `Applying ${t} to a real decision` },
  ];
}

export function onboardingComplete(profile: { onboarding: { status: string } } | null): boolean {
  return profile?.onboarding.status === "complete";
}
