import type { TamboComponent } from "@tambo-ai/react";
import { ProbeArena } from "./components/ProbeArena";
import { CreditAssignmentReplay } from "./components/CreditAssignmentReplay";
import { TargetedRetryGym } from "./components/TargetedRetryGym";
import { LayerOrderTransferGym } from "./components/LayerOrderTransferGym";
import {
  ProbeArenaSchema,
  CreditAssignmentReplaySchema,
  TargetedRetryGymSchema,
  LayerOrderTransferGymSchema,
} from "./schemas";

/**
 * Every component Codex may name in a component block.
 *
 * A name absent from this list renders the fallback, so this array is the
 * whole allowlist. Descriptions say when to use a surface, not just what it is.
 */
export const gymComponents: TamboComponent[] = [
  {
    name: "ProbeArena",
    description: "A Pioneer-certified diagnostic exercise",
    component: ProbeArena,
    propsSchema: ProbeArenaSchema,
  },
  {
    name: "CreditAssignmentReplay",
    description: "Visual feedback grounded in response evidence",
    component: CreditAssignmentReplay,
    propsSchema: CreditAssignmentReplaySchema,
  },
  {
    name: "TargetedRetryGym",
    description: "A scaffolded retry aimed at one failed skill",
    component: TargetedRetryGym,
    propsSchema: TargetedRetryGymSchema,
  },
  {
    name: "LayerOrderTransferGym",
    description: "Tests whether a learned ordering transfers to a new surface",
    component: LayerOrderTransferGym,
    propsSchema: LayerOrderTransferGymSchema,
  },
];
