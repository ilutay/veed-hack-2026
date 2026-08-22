import {
  gymApiRequestSchema,
  gymApiResponseSchema,
  humanUiEventSchema,
  type CodexUiCommand,
  type ExerciseSubmissionDraft,
  type ExerciseUiCommand,
  type GymApiRequest,
  type GymApiResponse,
  type HumanUiEvent,
  type JourneyProgress,
  type UiReceipt,
} from "../../../src/lib/tambo/gym-contract";
import {
  verifyCodexUiCommandIntegrity,
  type CommandIntegrityFailureCode,
} from "../../../src/lib/tambo/command-integrity";

export type {
  CodexUiCommand,
  ExerciseSubmissionDraft,
  ExerciseUiCommand,
  GymApiRequest,
  GymApiResponse,
  HumanUiEvent,
  JourneyProgress,
  UiReceipt,
};

export const NOVEL_ACCESS_ENDPOINT = "/api/auth/access";
export const NOVEL_GYM_ENDPOINT = "/api/gym";

export interface NovelBackendRequestOptions {
  endpoint?: string;
  fetchImpl?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export interface AccessStatus {
  authenticated: boolean;
}

export interface AccessGrant {
  ok: true;
  expiresAt: string;
}

export type VerifiedGymApiResponse = GymApiResponse & {
  /** Parsed, integrity-checked props. Render these instead of raw response data. */
  verifiedProps: unknown;
};

interface NovelBackendErrorOptions {
  cause?: unknown;
  code: string;
  retryable?: boolean;
  status?: number;
}

export class NovelBackendError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(message: string, options: NovelBackendErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "NovelBackendError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 0;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof NovelBackendError &&
    (error.status === 401 || error.code === "unauthorized")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strictKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new NovelBackendError(
      `The backend returned invalid JSON (HTTP ${response.status}).`,
      {
        cause,
        code: "invalid_json_response",
        status: response.status,
      },
    );
  }
}

function responseError(response: Response, payload: unknown): NovelBackendError {
  const error = isRecord(payload) && typeof payload.error === "string"
    ? payload.error
    : `The backend returned HTTP ${response.status}.`;
  const code = isRecord(payload) && typeof payload.code === "string"
    ? payload.code
    : "http_error";
  const retryable =
    isRecord(payload) && typeof payload.retryable === "boolean"
      ? payload.retryable
      : response.status === 429 || response.status === 503;

  return new NovelBackendError(error, {
    code,
    retryable,
    status: response.status,
  });
}

async function request(
  endpoint: string,
  init: RequestInit,
  options: NovelBackendRequestOptions,
): Promise<{ payload: unknown; response: Response }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new NovelBackendError("The browser Fetch API is unavailable.", {
      code: "fetch_unavailable",
    });
  }

  let response: Response;
  try {
    response = await fetchImpl(options.endpoint ?? endpoint, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch (cause) {
    throw new NovelBackendError(
      options.signal?.aborted
        ? "The backend request was aborted."
        : "The backend request could not be completed.",
      {
        cause,
        code: options.signal?.aborted ? "request_aborted" : "network_error",
        retryable: !options.signal?.aborted,
      },
    );
  }

  const payload = await readJson(response);
  return { payload, response };
}

export async function checkAccess(
  options: NovelBackendRequestOptions = {},
): Promise<AccessStatus> {
  const { payload, response } = await request(
    NOVEL_ACCESS_ENDPOINT,
    { method: "GET" },
    options,
  );

  if (response.status === 401) return { authenticated: false };
  if (!response.ok) throw responseError(response, payload);
  if (
    !isRecord(payload) ||
    !strictKeys(payload, ["authenticated"]) ||
    payload.authenticated !== true
  ) {
    throw new NovelBackendError("The access endpoint returned an invalid response.", {
      code: "invalid_access_response",
      status: response.status,
    });
  }

  return { authenticated: true };
}

export async function unlockAccess(
  accessCode: string,
  options: NovelBackendRequestOptions = {},
): Promise<AccessGrant> {
  const normalizedCode = accessCode.trim();
  if (!normalizedCode) {
    throw new NovelBackendError("Enter the shared access code.", {
      code: "invalid_request",
      status: 400,
    });
  }

  const { payload, response } = await request(
    NOVEL_ACCESS_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessCode: normalizedCode }),
    },
    options,
  );

  if (!response.ok) throw responseError(response, payload);
  if (
    !isRecord(payload) ||
    !strictKeys(payload, ["expiresAt", "ok"]) ||
    payload.ok !== true ||
    typeof payload.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw new NovelBackendError("The access endpoint returned an invalid grant.", {
      code: "invalid_access_response",
      status: response.status,
    });
  }

  return { ok: true, expiresAt: payload.expiresAt };
}

export async function postGym(
  input: GymApiRequest,
  options: NovelBackendRequestOptions = {},
): Promise<VerifiedGymApiResponse> {
  const requestResult = gymApiRequestSchema.safeParse(input);
  if (!requestResult.success) {
    throw new NovelBackendError("The gym request does not match the canonical event contract.", {
      code: "invalid_gym_request",
      status: 400,
      cause: requestResult.error,
    });
  }
  if (
    requestResult.data.sessionId &&
    requestResult.data.sessionId !== requestResult.data.event.sessionId
  ) {
    throw new NovelBackendError(
      "The request session does not match the event session.",
      {
        code: "invalid_gym_request",
        status: 400,
      },
    );
  }

  const { payload, response } = await request(
    NOVEL_GYM_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestResult.data),
    },
    options,
  );

  if (!response.ok) throw responseError(response, payload);

  const responseResult = gymApiResponseSchema.safeParse(payload);
  if (!responseResult.success) {
    throw new NovelBackendError("The gym endpoint returned a non-canonical response.", {
      code: "invalid_gym_response",
      status: response.status,
      cause: responseResult.error,
    });
  }
  if (
    responseResult.data.sessionId !== responseResult.data.command.sessionId ||
    responseResult.data.sessionId !== requestResult.data.event.sessionId
  ) {
    throw new NovelBackendError(
      "The gym response is not bound to the requested session.",
      {
        code: "session_binding_failed",
        status: response.status,
      },
    );
  }

  const integrity = await verifyCodexUiCommandIntegrity(
    responseResult.data.command,
  );
  if (!integrity.success) {
    throw new NovelBackendError(
      `The gym command failed browser integrity verification (${integrity.code}).`,
      {
        code: "command_integrity_failed",
        status: response.status,
        cause: integrity.code satisfies CommandIntegrityFailureCode,
      },
    );
  }

  return {
    ...responseResult.data,
    verifiedProps: integrity.props,
  };
}

export interface EventBuilderOptions {
  clientCreatedAt?: string;
  eventId?: string;
}

export interface SubmissionEventBuilderOptions extends EventBuilderOptions {
  responseId?: string;
  submittedAt?: string;
}

type StartEvent = Extract<HumanUiEvent, { type: "start" }>;
type ExerciseSubmittedEvent = Extract<
  HumanUiEvent,
  { type: "exercise.submitted" }
>;
type FeedbackAcknowledgedEvent = Extract<
  HumanUiEvent,
  { type: "feedback.acknowledged" }
>;
type ComponentFailedEvent = Extract<
  HumanUiEvent,
  { type: "ui.component_failed" }
>;

function createClientId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `${prefix}_${cryptoApi.randomUUID()}`;
  }

  const entropy = new Uint32Array(4);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(entropy);
  } else {
    entropy.set(
      Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32)),
    );
  }
  const suffix = Array.from(entropy, (value) =>
    value.toString(16).padStart(8, "0"),
  ).join("");
  return `${prefix}_${Date.now().toString(36)}_${suffix}`;
}

export function createBrowserSessionId(): string {
  return createClientId("session");
}

function identity(command: CodexUiCommand, options: EventBuilderOptions) {
  const eventId = options.eventId ?? createClientId("event");
  return {
    eventId,
    idempotencyKey: eventId,
    sessionId: command.sessionId,
    sourceComponentId: command.component.id,
    clientCreatedAt: options.clientCreatedAt ?? new Date().toISOString(),
  };
}

function exerciseContext(command: ExerciseUiCommand) {
  return {
    commandId: command.commandId,
    goalInstanceId: command.goalInstanceId,
    episodeId: command.episodeId,
    exerciseId: command.exerciseId,
    exerciseRevision: command.exerciseRevision,
    validationId: command.validationId,
    renderContractId: command.renderContractId,
  };
}

function parseEvent<Event extends HumanUiEvent>(event: Event): Event {
  return humanUiEventSchema.parse(event) as Event;
}

export function buildStartEvent(
  command: CodexUiCommand,
  rawPrompt: string,
  options: EventBuilderOptions = {},
): StartEvent {
  return parseEvent({
    ...identity(command, options),
    type: "start",
    payload: { rawPrompt },
  });
}

export function buildExerciseSubmittedEvent(
  command: ExerciseUiCommand,
  draft: ExerciseSubmissionDraft,
  options: SubmissionEventBuilderOptions = {},
): ExerciseSubmittedEvent {
  return parseEvent({
    ...identity(command, options),
    ...exerciseContext(command),
    type: "exercise.submitted",
    payload: {
      responseId: options.responseId ?? createClientId("response"),
      action: {
        ...draft.responseContract,
        value: draft.actionValue,
      },
      reasoningText: draft.reasoningText?.trim() || undefined,
      reasoningTagIds: draft.reasoningTagIds ?? [],
      statedConfidence: draft.statedConfidence,
      submittedAt: options.submittedAt ?? new Date().toISOString(),
    },
  });
}

export function buildFeedbackAcknowledgedEvent(
  command: ExerciseUiCommand,
  evidenceId: string,
  options: EventBuilderOptions = {},
): FeedbackAcknowledgedEvent {
  return parseEvent({
    ...identity(command, options),
    ...exerciseContext(command),
    type: "feedback.acknowledged",
    payload: { evidenceId },
  });
}

export function buildComponentFailedEvent(
  command: CodexUiCommand,
  errorCode: string,
  options: EventBuilderOptions = {},
): ComponentFailedEvent {
  return parseEvent({
    ...identity(command, options),
    commandId: command.commandId,
    ...(command.commandKind === "exercise" ? exerciseContext(command) : {}),
    type: "ui.component_failed",
    payload: {
      errorCode,
      failedCommandId: command.commandId,
    },
  });
}
