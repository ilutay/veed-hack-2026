import { z } from "zod";

import { GYM_ACCESS_COOKIE, type AccessController } from "./access";
import type { GymEngine } from "./engine";
import { GymError, toGymError } from "./errors";
import type { FixedWindowRateLimiter } from "./rate-limit";
import { gymRuntime, type GymRuntime } from "./runtime";

const accessRequestSchema = z
  .object({ accessCode: z.string().trim().min(1).max(256) })
  .strict();

type HttpRuntime = Pick<
  GymRuntime,
  "engine" | "access" | "gymRateLimiter" | "accessRateLimiter"
>;

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function errorResponse(rawError: unknown): Response {
  const error = toGymError(rawError);
  const headers = new Headers();
  if (error.retryAfterSeconds) {
    headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return json(
    {
      error: error.message,
      code: error.code,
      retryable: error.status === 429 || error.status === 503,
    },
    error.status,
    headers,
  );
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown-client";
}

function enforceRateLimit(
  limiter: FixedWindowRateLimiter,
  key: string,
  message: string,
) {
  const result = limiter.take(key);
  if (!result.allowed) {
    throw new GymError(429, "rate_limited", message, {
      retryAfterSeconds: result.retryAfterSeconds,
    });
  }
}

function enforceSameOrigin(request: Request) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return;
  const expectedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!expectedHost) return;
  try {
    if (new URL(rawOrigin).host !== expectedHost) {
      throw new GymError(401, "unauthorized", "Cross-origin demo mutations are not allowed.");
    }
  } catch (error) {
    if (error instanceof GymError) throw error;
    throw new GymError(401, "unauthorized", "The request origin is invalid.");
  }
}

function enforceEngineReadiness(engine: GymEngine) {
  const health = engine.health();
  if (!health.ready) {
    throw new GymError(
      503,
      "service_unavailable",
      "The Codex and Pioneer execution boundary is not ready.",
    );
  }
  if (
    process.env.WORKFLOW_MODE === "live" &&
    (health.providers.codex.mode !== "live" ||
      health.providers.pioneer.mode !== "live")
  ) {
    throw new GymError(
      503,
      "service_unavailable",
      "Live mode requires both live Codex and live Pioneer adapters.",
    );
  }
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new GymError(400, "invalid_request", "Content-Type must be application/json.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new GymError(400, "invalid_request", "The request body is too large.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new GymError(400, "invalid_request", "The request body is not valid JSON.", {
      cause: error,
    });
  }
}

export async function handleGymPost(
  request: Request,
  runtime: HttpRuntime = gymRuntime,
): Promise<Response> {
  try {
    enforceSameOrigin(request);
    runtime.access.verifyRequest(request);
    enforceEngineReadiness(runtime.engine);
    enforceRateLimit(
      runtime.gymRateLimiter,
      clientAddress(request),
      "This client has reached the demo request limit. Retry after the window resets.",
    );
    const payload = await readJson(request, 32 * 1_024);
    const response = await runtime.engine.handle(payload, request.signal);
    return json(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAccessPost(
  request: Request,
  runtime: HttpRuntime = gymRuntime,
): Promise<Response> {
  try {
    enforceSameOrigin(request);
    enforceRateLimit(
      runtime.accessRateLimiter,
      clientAddress(request),
      "Too many access-code attempts. Retry after the window resets.",
    );
    const payload = accessRequestSchema.safeParse(await readJson(request, 1_024));
    if (!payload.success) {
      throw new GymError(400, "invalid_request", "The access request is invalid.");
    }
    const grant = runtime.access.exchange(payload.data.accessCode);
    return json(
      { ok: true, expiresAt: grant.expiresAt },
      200,
      { "set-cookie": runtime.access.serializeCookie(grant) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAccessGet(
  request: Request,
  runtime: HttpRuntime = gymRuntime,
): Response {
  try {
    runtime.access.verifyRequest(request);
    return json({ authenticated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleAccessDelete(
  request: Request,
  runtime: HttpRuntime = gymRuntime,
): Response {
  try {
    enforceSameOrigin(request);
    return json(
      { ok: true },
      200,
      { "set-cookie": runtime.access.serializeClearCookie() },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export function handleHealthGet(
  runtime: Pick<HttpRuntime, "engine" | "access"> = gymRuntime,
): Response {
  const engineHealth = runtime.engine.health();
  const accessReady = runtime.access.isReady();
  const workflowMode = process.env.WORKFLOW_MODE ?? "dry-run";
  const liveAdaptersReady =
    workflowMode !== "live" ||
    (engineHealth.providers.codex.mode === "live" &&
      engineHealth.providers.pioneer.mode === "live");
  const ready = accessReady && engineHealth.ready && liveAdaptersReady;
  return json(
    {
      ok: true,
      ready,
      service: "pioneer-gym",
      workflowMode,
      auth: {
        configured: accessReady,
        cookie: GYM_ACCESS_COOKIE,
      },
      engine: engineHealth,
      liveAdaptersReady,
      componentRendererBackend: false,
    },
    ready ? 200 : 503,
  );
}

export type GymHttpDependencies = {
  engine: GymEngine;
  access: AccessController;
  gymRateLimiter: FixedWindowRateLimiter;
  accessRateLimiter: FixedWindowRateLimiter;
};
