import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getGymComponentDefinition } from "../contracts/gym-components";
import {
  compareArenaProps,
  demoFixtureBindings,
  digest,
  exerciseCommand,
  feedbackProps,
} from "../gym/demo-fixtures";
import { verifyCodexUiCommandIntegrity } from "./command-integrity";
import { codexUiCommandSchema, type ExerciseUiCommand } from "./gym-contract";

function baselineCommand(): ExerciseUiCommand {
  const binding = demoFixtureBindings.baseline;
  const command = exerciseCommand(
    "session_integrity",
    "goal_integrity",
    binding.componentName,
    compareArenaProps("prevalidated"),
    binding.exerciseId,
    binding.revision,
    binding.validationId,
  );
  if (command.commandKind !== "exercise") throw new Error("expected exercise");
  return command;
}

describe("browser command integrity", () => {
  it("accepts an exact P1, GymSpec, Codex, and visible-props binding", async () => {
    await expect(
      verifyCodexUiCommandIntegrity(baselineCommand()),
    ).resolves.toMatchObject({ success: true });
  });

  it.each([
    [
      "visible props",
      (command: ExerciseUiCommand) => {
        const props = command.component.props as Record<string, unknown>;
        props.title = "A well-shaped but altered learner-facing title";
      },
      "pedagogical_props_mismatch",
    ],
    [
      "validation receipt",
      (command: ExerciseUiCommand) => {
        const props = command.component.props as {
          validationReceipt: { contentHash: string };
        };
        props.validationReceipt.contentHash = "f".repeat(64);
      },
      "validation_binding_mismatch",
    ],
    [
      "render contract",
      (command: ExerciseUiCommand) => {
        command.renderContractId = "render_drifted_v1";
      },
      "gym_spec_binding_mismatch",
    ],
  ] as const)("stops a drifted %s before Tambo", async (_label, mutate, code) => {
    const command = structuredClone(baselineCommand());
    mutate(command);

    await expect(verifyCodexUiCommandIntegrity(command)).resolves.toEqual({
      success: false,
      code,
    });
  });

  it("uses a separate source-bound policy for feedback commands", async () => {
    const source = baselineCommand();
    const props = feedbackProps("frame-b");
    const command = codexUiCommandSchema.parse({
      ...source,
      commandPurpose: "feedback",
      commandId: "command_feedback",
      renderContractId: `${source.renderContractId}.feedback`,
      component: {
        type: "component",
        id: "component_feedback",
        name: "CreditAssignmentReplay",
        props,
        streamingState: "done",
      },
      componentSchemaVersion: getGymComponentDefinition(
        "CreditAssignmentReplay",
      ).schemaVersion,
      pedagogicalPropsSha256: digest(props),
    });

    await expect(verifyCodexUiCommandIntegrity(command)).resolves.toMatchObject({
      success: true,
    });

    const drifted = structuredClone(command);
    (drifted.component.props as { summary: string }).summary =
      "A well-shaped but altered feedback summary";
    await expect(verifyCodexUiCommandIntegrity(drifted)).resolves.toEqual({
      success: false,
      code: "feedback_binding_mismatch",
    });
  });
});
