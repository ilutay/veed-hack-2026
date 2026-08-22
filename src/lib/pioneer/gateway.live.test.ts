import { describe, expect, it } from "vitest";

import { createPioneerTextGateway } from "./gateway";
import { makeValidateFixture } from "./gateway.test-fixtures";

const liveEnabled = process.env.RUN_LIVE_PIONEER_SMOKE === "1";

describe.runIf(liveEnabled)("PioneerTextGateway live smoke", () => {
  it("returns one schema-valid, exactly bound P1 judgment", async () => {
    const apiKey = process.env.PIONEER_API_KEY;
    const model = process.env.PIONEER_MODEL;
    if (!apiKey || !model) {
      throw new Error("PIONEER_API_KEY and PIONEER_MODEL are required for the explicit live smoke");
    }

    const { input, rawFalText } = makeValidateFixture();
    const gateway = createPioneerTextGateway({
      workflowMode: "live",
      apiKey,
      model,
      resolveFalText: () => rawFalText,
    });

    const result = await gateway.validateExercise(input);

    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.response.requestId).toBe(input.requestId);
      expect(result.response.exerciseId).toBe(input.candidate.exerciseId);
      expect(result.response.candidateContentHash).toBe(
        input.candidate.provenance.contentHash,
      );
      expect(["PASS", "REJECT", "ABSTAIN"]).toContain(result.response.judgment);
    }
  });
});
