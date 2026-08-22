import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getGymComponentDefinition } from "../contracts/gym-components";
import { codexUiCommandSchema } from "../tambo/gym-contract";
import {
  compareArenaProps,
  demoFixtureBindings,
  digest,
  exerciseCommand,
  retryProps,
} from "./demo-fixtures";

describe("demo fixture integrity", () => {
  it("binds the exact P1 content hash into the Codex command", () => {
    const binding = demoFixtureBindings.baseline;
    const props = compareArenaProps("prevalidated");
    const command = exerciseCommand(
      "session:test",
      "goal:test",
      binding.componentName,
      props,
      binding.exerciseId,
      binding.revision,
      binding.validationId,
    );

    expect(command.commandKind).toBe("exercise");
    if (command.commandKind !== "exercise") return;
    expect(command.gymSpecHash).toBe(props.validationReceipt.contentHash);
    expect(command.validationId).toBe(props.validationReceipt.validationId);
    expect(command.componentSchemaVersion).toBe(
      getGymComponentDefinition(binding.componentName).schemaVersion,
    );
    expect(codexUiCommandSchema.safeParse(command).success).toBe(true);
    expect(props.validationReceipt.detail).toContain("not a runtime fallback");
  });

  it("uses retry-specific response IDs and option values", () => {
    const props = retryProps("prevalidated");
    expect(props.responseContract.schemaId).toBe(
      "visual-hierarchy-retry-choice",
    );
    expect(props.responseContract.schemaSha256).toBe(
      digest({
        type: "object",
        required: ["choiceId"],
        properties: { choiceId: { enum: ["retry-a", "retry-b"] } },
      }),
    );
    expect(props.variants.map(({ id }) => id)).toEqual(["retry-a", "retry-b"]);
  });

  it("refuses command metadata that drifts from the P1 receipt", () => {
    const binding = demoFixtureBindings.retry;
    const props = retryProps("prevalidated");

    expect(() =>
      exerciseCommand(
        "session:test",
        "goal:test",
        binding.componentName,
        props,
        binding.exerciseId,
        binding.revision + 1,
        binding.validationId,
      ),
    ).toThrow("must exactly match its P1 validation receipt");
  });
});
