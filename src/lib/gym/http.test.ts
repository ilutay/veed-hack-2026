import { describe, expect, it, vi } from "vitest";

import { createAccessController, hashAccessCode } from "./access";
import { createGymEngine } from "./engine";
import {
  handleAccessPost,
  handleGymPost,
  handleHealthGet,
  type GymHttpDependencies,
} from "./http";
import { FixedWindowRateLimiter } from "./rate-limit";

const ACCESS_CODE = "judge-demo-code";

function dependencies(now: () => Date = () => new Date("2026-08-22T12:00:00.000Z")): GymHttpDependencies {
  return {
    engine: createGymEngine({ now }),
    access: createAccessController({
      accessCodeSha256: hashAccessCode(ACCESS_CODE),
      cookieSecret: "a-cookie-signing-secret-with-at-least-32-bytes",
      now,
      nonce: () => "fixed_nonce_for_http_test",
    }),
    gymRateLimiter: new FixedWindowRateLimiter({ maxRequests: 60, windowMs: 60_000, now }),
    accessRateLimiter: new FixedWindowRateLimiter({ maxRequests: 5, windowMs: 60_000, now }),
  };
}

function jsonRequest(url: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("gym HTTP boundary", () => {
  it("exchanges a digest-checked access code for a hardened cookie", async () => {
    const runtime = dependencies();
    const response = await handleAccessPost(
      jsonRequest("https://gym.example/api/auth/access", { accessCode: ACCESS_CODE }),
      runtime,
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toContain("pioneer_gym_access=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(ACCESS_CODE);
  });

  it("runs the real HTTP -> engine -> renderer-contract path without live providers", async () => {
    const runtime = dependencies();
    const engineHandle = vi.spyOn(runtime.engine, "handle");
    const access = await handleAccessPost(
      jsonRequest("https://gym.example/api/auth/access", { accessCode: ACCESS_CODE }),
      runtime,
    );
    const cookie = access.headers.get("set-cookie")!.split(";")[0];
    const event = {
      sessionId: "session_http_e2e",
      event: {
        eventId: "event_http_start",
        idempotencyKey: "event_http_start",
        sessionId: "session_http_e2e",
        sourceComponentId: "component_http_bootstrap",
        clientCreatedAt: "2026-08-22T12:00:00.000Z",
        type: "start",
        payload: { rawPrompt: "I want to make intentional product videos" },
      },
    };
    const response = await handleGymPost(
      jsonRequest("https://gym.example/api/gym", event, { cookie }),
      runtime,
    );
    expect(engineHandle).toHaveBeenCalledWith(event, expect.any(AbortSignal));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      sessionId: "session_http_e2e",
      command: {
        commandKind: "exercise",
        issuedBy: "codex",
        component: { name: "CompareArena" },
      },
      receipts: [
        { kind: "p1_validation", status: "pass", provenance: "prevalidated" },
      ],
    });
  });

  it("returns clear 401, 429, and readiness responses", async () => {
    const runtime = dependencies();
    const unauthorized = await handleGymPost(
      jsonRequest("https://gym.example/api/gym", {}),
      runtime,
    );
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: "unauthorized",
    });

    for (let index = 0; index < 5; index += 1) {
      await handleAccessPost(
        jsonRequest("https://gym.example/api/auth/access", { accessCode: "wrong" }),
        runtime,
      );
    }
    const limited = await handleAccessPost(
      jsonRequest("https://gym.example/api/auth/access", { accessCode: "wrong" }),
      runtime,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    const health = handleHealthGet(runtime);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({
      ready: true,
      engine: {
        limits: {
          activeSessions: 2,
          retainedSessions: 20,
          providerCalls: 2,
          pioneerCallsPerSession: 3,
          codexCallsPerSession: 3,
          sessionTtlSeconds: 900,
        },
      },
    });

    const unavailable = handleHealthGet({
      engine: runtime.engine,
      access: createAccessController(),
    });
    expect(unavailable.status).toBe(503);
  });
});
