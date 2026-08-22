import { createAccessController } from "./access";
import { createGymEngine } from "./engine";
import {
  LiveGymCodexClient,
  LiveGymPioneerClient,
} from "./live-providers";
import {
  DeterministicSkillCodexClient,
  DeterministicSkillPioneerClient,
} from "./providers";
import { FixedWindowRateLimiter } from "./rate-limit";

export interface GymRuntimeEnvironment {
  WORKFLOW_MODE?: string;
  PIONEER_API_KEY?: string;
  PIONEER_MODEL?: string;
  GYM_ACCESS_CODE_SHA256?: string;
  GYM_COOKIE_SECRET?: string;
}

export function createGymRuntime(environment?: GymRuntimeEnvironment) {
  const resolvedEnvironment = environment ?? {
    WORKFLOW_MODE: process.env.WORKFLOW_MODE,
    PIONEER_API_KEY: process.env.PIONEER_API_KEY,
    PIONEER_MODEL: process.env.PIONEER_MODEL,
    GYM_ACCESS_CODE_SHA256: process.env.GYM_ACCESS_CODE_SHA256,
    GYM_COOKIE_SECRET: process.env.GYM_COOKIE_SECRET,
  };
  const live = resolvedEnvironment.WORKFLOW_MODE === "live";
  const engine = createGymEngine({
    codexClient: live
      ? new LiveGymCodexClient()
      : new DeterministicSkillCodexClient(),
    pioneerClient: live
      ? new LiveGymPioneerClient({
          apiKey: resolvedEnvironment.PIONEER_API_KEY,
          model: resolvedEnvironment.PIONEER_MODEL,
        })
      : new DeterministicSkillPioneerClient(),
  });
  const access = createAccessController({
    accessCodeSha256: resolvedEnvironment.GYM_ACCESS_CODE_SHA256,
    cookieSecret: resolvedEnvironment.GYM_COOKIE_SECRET,
  });

  return {
    engine,
    access,
    gymRateLimiter: new FixedWindowRateLimiter({
      maxRequests: 60,
      windowMs: 60_000,
    }),
    accessRateLimiter: new FixedWindowRateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
    }),
  };
}

export const gymRuntime = createGymRuntime();

export type GymRuntime = typeof gymRuntime;
