"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  gymApiResponseSchema,
  type CodexUiCommand,
  type GymApiRequest,
  type HumanUiEvent,
  type JourneyProgress,
} from "@/lib/gym-ui/gym-contract";
import { LIVE_GYM_UI_DEADLINE_MS } from "@/lib/contracts/live-deadlines";

import { CodexActionProvider } from "./codex-action-context";
import { CommandRenderer } from "./command-renderer";
import styles from "./gym.module.css";

const initialProgress: JourneyProgress = {
  steps: [
    { id: "prompt", label: "Prompt", state: "active" },
    { id: "validate", label: "Validate", state: "upcoming" },
    { id: "practice", label: "Practice", state: "upcoming" },
    { id: "adapt", label: "Adapt", state: "upcoming" },
    { id: "transfer", label: "Transfer", state: "upcoming" },
  ],
  learningStatus: "not_started",
};

function bootstrapCommand(sessionId: string): CodexUiCommand {
  return {
    commandKind: "shell",
    commandId: "command_bootstrap_learning_prompt",
    sessionId,
    issuedBy: "codex",
    component: {
      type: "component",
      id: "component_learning_prompt",
      name: "LearningPrompt",
      props: {
        eyebrow: "PIONEER GYM / HUMAN LEARNING",
        title: "What do you want to learn?",
        description:
          "Describe a skill or judgment. Codex will turn it into a short practice session, and Pioneer will adapt the next rep to your evidence.",
        placeholder: "I want to make short-form product videos that feel intentional, not generic.",
        submitLabel: "Start practicing",
        examples: [
          "I want to make short-form product videos that feel intentional, not generic.",
          "Teach me to spot weak visual hierarchy.",
          "Help me make creative choices I can defend.",
        ],
        supportedEnvelope:
          "Demo focus: visual hierarchy and creative judgment.",
        sessionTimeboxSeconds: 90,
      },
      streamingState: "done",
    },
    componentSchemaVersion: "learning-prompt-v1",
    issuedAt: "2026-08-22T00:00:00.000Z",
  };
}

function pendingCopy(event: HumanUiEvent) {
  switch (event.type) {
    case "start":
      return {
        title: "Building your first practice rep",
        detail: "Codex is turning your goal into a focused decision you can practice now.",
      };
    case "feedback.acknowledged":
      return {
        title: "Choosing the next edge to train",
        detail: "Pioneer is using your latest evidence to pick the most useful next rep.",
      };
    case "ui.component_failed":
      return {
        title: "Finding a safe way forward",
        detail: "Codex is checking the approved exercise inventory.",
      };
    default:
      return {
        title: "Reading your response",
        detail: "Your choice, reasoning, and confidence are being scored together.",
      };
  }
}

export interface GymExperienceProps {
  endpoint?: string;
}

function createBrowserSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `session_${cryptoApi.randomUUID()}`;
  }

  const entropy = new Uint32Array(4);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(entropy);
  } else {
    entropy.set(Array.from({ length: 4 }, () => Math.floor(Math.random() * 2 ** 32)));
  }
  const randomPart = Array.from(entropy, (value) => value.toString(16)).join("");
  return `session_${Date.now().toString(36)}_${randomPart}`;
}

export function GymExperience({ endpoint = "/api/gym" }: GymExperienceProps) {
  const reactId = useId().replaceAll(":", "");
  const bootstrapSessionId = `session_bootstrap_${reactId}`;
  const [sessionId, setSessionId] = useState(bootstrapSessionId);
  const [command, setCommand] = useState<CodexUiCommand>(() =>
    bootstrapCommand(bootstrapSessionId),
  );
  const [sessionReady, setSessionReady] = useState(false);
  const [progress, setProgress] = useState<JourneyProgress>(initialProgress);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingState, setPendingState] = useState({ title: "", detail: "" });
  const lastRequest = useRef<GymApiRequest | null>(null);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const browserSessionId = createBrowserSessionId();
      setSessionId(browserSessionId);
      setCommand(bootstrapCommand(browserSessionId));
      setSessionReady(true);
    }, 0);
    return () => window.clearTimeout(initialize);
  }, []);

  const sendRequest = useCallback(
    async (request: GymApiRequest) => {
      setPending(true);
      setError(null);
      lastRequest.current = request;

      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        LIVE_GYM_UI_DEADLINE_MS,
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          cache: "no-store",
          signal: controller.signal,
        });

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const serverMessage =
            payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : `The gym endpoint returned ${response.status}.`;
          throw new Error(serverMessage);
        }

        const parsed = gymApiResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error("Codex returned a command that does not match the renderer contract.");
        }

        setSessionId(parsed.data.sessionId);
        setCommand(parsed.data.command);
        if (parsed.data.progress) setProgress(parsed.data.progress);
        setMessage(parsed.data.message ?? null);
      } catch (caught) {
        const timedOut = caught instanceof DOMException && caught.name === "AbortError";
        setError(
          timedOut
            ? "The request hit the 22-second UI deadline. Nothing was retried automatically."
            : caught instanceof Error
              ? caught.message
              : "The gym request failed before a new command was accepted.",
        );
      } finally {
        window.clearTimeout(timeout);
        setPending(false);
      }
    },
    [endpoint],
  );

  const emit = useCallback(
    async (event: HumanUiEvent) => {
      if (!sessionReady) return;
      setPendingState(pendingCopy(event));
      await sendRequest({ sessionId, event });
    },
    [sendRequest, sessionId, sessionReady],
  );

  const retry = () => {
    if (lastRequest.current) void sendRequest(lastRequest.current);
  };
  const interactionPending = pending || !sessionReady;

  return (
    <main className={styles.gymRoot}>
      <div className={styles.appShell}>
        <header className={styles.appHeader}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>PG</span>
            <span>Pioneer Gym<small>Practice that adapts to you</small></span>
          </div>
          <div className={styles.headerActions}>
            <span>Codex runs · Pioneer adapts</span>
            <Link className={styles.lessonLink} href="/lesson">Watch a real lesson</Link>
          </div>
        </header>

        <ol className={styles.journeyNav} aria-label="Learning journey">
          {progress.steps.map((step, index) => (
            <li
              aria-current={step.state === "active" ? "step" : undefined}
              aria-label={`${index + 1}. ${step.label}: ${step.state}`}
              className={styles.journeyStep}
              data-state={step.state}
              key={step.id}
            >
              <span className={styles.journeyIndex}>{String(index + 1).padStart(2, "0")}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>

        {message ? <div className={styles.messageBanner} role="status">{message}</div> : null}
        {error ? (
          <div className={styles.errorBanner} role="alert">
            <span>{error}</span>
            <button disabled={interactionPending} onClick={retry} type="button">Retry</button>
          </div>
        ) : null}

        <section className={`${styles.stage} ${interactionPending ? styles.stageBusy : ""}`} aria-busy={interactionPending}>
            <CodexActionProvider command={command} emit={emit} pending={interactionPending}>
              <CommandRenderer command={command} />
            </CodexActionProvider>
            {interactionPending ? (
              <div className={styles.pendingVeil} aria-live="polite">
                <div className={styles.pendingCard}>
                  <div className={styles.pulseLine} />
                  <strong>{sessionReady ? pendingState.title : "Preparing a private learner session"}</strong>
                  <p>{sessionReady ? pendingState.detail : "Binding this page to a fresh session before accepting input."}</p>
                </div>
              </div>
            ) : null}
        </section>
      </div>
    </main>
  );
}
