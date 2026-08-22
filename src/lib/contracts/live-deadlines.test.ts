import { describe, expect, it } from "vitest";

import {
  LIVE_CODEX_ACTION_DEADLINE_MS,
  LIVE_GYM_PROVIDER_DEADLINE_MS,
  LIVE_GYM_UI_DEADLINE_MS,
  LIVE_TEAMBOX_CLIENT_DEADLINE_MS,
  LIVE_TEAMBOX_GATEWAY_DEADLINE_MS,
} from "./live-deadlines";

describe("live request deadline chain", () => {
  it("keeps every cleanup boundary outside the operation it owns", () => {
    expect([
      LIVE_CODEX_ACTION_DEADLINE_MS,
      LIVE_TEAMBOX_GATEWAY_DEADLINE_MS,
      LIVE_TEAMBOX_CLIENT_DEADLINE_MS,
      LIVE_GYM_PROVIDER_DEADLINE_MS,
      LIVE_GYM_UI_DEADLINE_MS,
      25_000,
    ]).toEqual([15_000, 16_000, 18_000, 20_000, 22_000, 25_000]);
  });
});
