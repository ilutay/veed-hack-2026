export type GymErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "session_conflict"
  | "stale_command"
  | "idempotency_conflict"
  | "session_capacity"
  | "provider_capacity"
  | "provider_budget"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_contract_violation"
  | "service_unavailable";

export class GymError extends Error {
  readonly status: 400 | 401 | 409 | 429 | 503;
  readonly code: GymErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(
    status: GymError["status"],
    code: GymErrorCode,
    message: string,
    options: { cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GymError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function toGymError(error: unknown): GymError {
  if (error instanceof GymError) return error;
  return new GymError(
    503,
    "service_unavailable",
    "The gym could not complete this event. Nothing was retried automatically.",
    { cause: error },
  );
}
