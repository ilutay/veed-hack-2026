import { z } from "zod";

export const GYM_SPEC_SCHEMA_VERSION = "gym-spec-v1" as const;
export const GYM_CONTENT_HASH_VERSION = "gym-jcs-v1" as const;

export const GYM_COMPONENT_ROLES = [
  "shell",
  "action",
  "feedback",
  "fallback",
] as const;

export type GymComponentRole = (typeof GYM_COMPONENT_ROLES)[number];

/**
 * The runtime-neutral authority for every component Codex may ask the local
 * renderer to show. Pioneer imports the same catalog, so an unregistered component can
 * never reach a P1 PASS.
 */
export const GYM_COMPONENT_DEFINITIONS = {
  LearningPrompt: {
    schemaVersion: "learning-prompt-v1",
    role: "shell",
  },
  CompareArena: {
    schemaVersion: "compare-arena-v1",
    role: "action",
  },
  CreditAssignmentReplay: {
    schemaVersion: "credit-assignment-replay-v1",
    role: "feedback",
  },
  TargetedRetryGym: {
    schemaVersion: "targeted-retry-gym-v1",
    role: "action",
  },
  LayerOrderTransferGym: {
    schemaVersion: "layer-order-transfer-gym-v1",
    role: "action",
  },
  SafeExerciseFallback: {
    schemaVersion: "safe-exercise-fallback-v1",
    role: "fallback",
  },
} as const satisfies Record<
  string,
  { readonly schemaVersion: string; readonly role: GymComponentRole }
>;

export type GymComponentName = keyof typeof GYM_COMPONENT_DEFINITIONS;

const componentNames = Object.keys(GYM_COMPONENT_DEFINITIONS) as [
  GymComponentName,
  ...GymComponentName[],
];

export const GYM_COMPONENT_NAMES = Object.freeze(componentNames);

export const gymComponentNameSchema = z.enum(GYM_COMPONENT_NAMES);
export const gymComponentRoleSchema = z.enum(GYM_COMPONENT_ROLES);

export function getGymComponentDefinition<Name extends GymComponentName>(
  name: Name,
): (typeof GYM_COMPONENT_DEFINITIONS)[Name] {
  return GYM_COMPONENT_DEFINITIONS[name];
}

export function isGymComponentAllowedForRenderPhase(
  name: GymComponentName,
  phase: "action" | "feedback",
): boolean {
  const role = getGymComponentDefinition(name).role;
  return phase === "feedback"
    ? role === "feedback"
    : role === "action" || role === "fallback";
}
