"use client";

import {
  useCallback,
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
  type UiReceipt,
} from "@/lib/tambo/gym-contract";

import { CodexActionProvider } from "./codex-action-context";
import styles from "./gym.module.css";
import { TamboReceiptRenderer } from "./tambo-receipt-renderer";

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
        eyebrow: "PIONEER GYM / HUMAN RL SESSION",
        title: "Train the decision, not the answer.",
        description:
          "Tell Codex what you want to learn. It will build a short practice gym where Pioneer certifies each rep, reads your evidence, and tests transfer before making a learning claim.",
        placeholder: "I want to make short-form product videos that feel intentional, not generic.",
        submitLabel: "Build my first rep",
        examples: [
          "I want to make short-form product videos that feel intentional, not generic.",
          "Teach me to spot weak visual hierarchy.",
          "Help me make creative choices I can defend.",
        ],
        supportedEnvelope:
          "Live demo focus: visual hierarchy and creative judgment.",
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
        title: "Codex is interpreting your learning goal",
        detail: "Codex binds the goal to the exact prevalidated baseline fixture and loads its Pioneer #1 teaching-signal receipt.",
      };
    case "feedback.acknowledged":
      return {
        title: "Pioneer #2 is finding your next edge",
        detail: "It chooses from the eligible curriculum to maximize transferable learning gain per minute; Codex validates and renders that exact choice.",
      };
    case "ui.component_failed":
      return {
        title: "Codex is checking the safe inventory",
        detail: "Only a separately validated fallback may replace the failed command.",
      };
    default:
      return {
        title: "The fixed rubric is scoring your evidence",
        detail: "Your choice, reasoning, and confidence were submitted atomically to the deterministic assessment policy.",
      };
  }
}

function ReceiptRail({ receipts, progress }: { receipts: UiReceipt[]; progress: JourneyProgress }) {
  return (
    <aside className={styles.receiptRail} aria-label="Pioneer and Codex evidence receipts">
      <div className={styles.railHeader}>
        <div>
          <strong>Evidence chain</strong>
          <small>Judgments are receipts. Codex owns every action.</small>
        </div>
        <span className={styles.statusPill}>{progress.learningStatus.replaceAll("_", " ")}</span>
      </div>
      {receipts.length ? (
        <div className={styles.receiptList}>
          {receipts.map((receipt) => (
            <article className={styles.receiptCard} key={receipt.id}>
              <div className={styles.receiptTopline}>
                <span>{receipt.kind.replaceAll("_", " ")} · {receipt.provenance}</span>
                <span>{receipt.status.replaceAll("_", " ")}</span>
              </div>
              <strong>{receipt.title}</strong>
              <p>{receipt.summary}</p>
              {receipt.reference ? <span className={styles.receiptRef}>{receipt.reference}</span> : null}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.emptyReceipts}>
          <span aria-hidden="true">↳</span>
          <p>Pioneer validation, human evidence, adaptation, and transfer receipts will appear here.</p>
        </div>
      )}
      <div className={styles.renderReceipt}>
        Tambo: registered-component renderer only<br />
        No agent · no API key · no tools · no thread state
      </div>
    </aside>
  );
}

export interface GymExperienceProps {
  endpoint?: string;
}

export function GymExperience({ endpoint = "/api/gym" }: GymExperienceProps) {
  const reactId = useId().replaceAll(":", "");
  const [sessionId, setSessionId] = useState(`session_${reactId}`);
  const [command, setCommand] = useState<CodexUiCommand>(() => bootstrapCommand(`session_${reactId}`));
  const [receipts, setReceipts] = useState<UiReceipt[]>([]);
  const [progress, setProgress] = useState<JourneyProgress>(initialProgress);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingState, setPendingState] = useState({ title: "", detail: "" });
  const lastRequest = useRef<GymApiRequest | null>(null);

  const sendRequest = useCallback(
    async (request: GymApiRequest) => {
      setPending(true);
      setError(null);
      lastRequest.current = request;

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);

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
        setReceipts(parsed.data.receipts);
        if (parsed.data.progress) setProgress(parsed.data.progress);
        setMessage(parsed.data.message ?? null);
      } catch (caught) {
        const timedOut = caught instanceof DOMException && caught.name === "AbortError";
        setError(
          timedOut
            ? "The request hit the 15-second UI deadline. Nothing was retried automatically."
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
      setPendingState(pendingCopy(event));
      await sendRequest({ sessionId, event });
    },
    [sendRequest, sessionId],
  );

  const retry = () => {
    if (lastRequest.current) void sendRequest(lastRequest.current);
  };

  return (
    <main className={styles.gymRoot}>
      <div className={styles.appShell}>
        <header className={styles.appHeader}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>PG</span>
            <span>Pioneer Gym<small>RL-style practice for humans</small></span>
          </div>
          <div className={styles.authorityLine} aria-label="System authority boundary">
            <span><i className={styles.authorityDot} />Codex operating</span>
            <span>Pioneer optimizes curriculum</span>
            <span>Tambo renders</span>
          </div>
        </header>

        <nav className={styles.journeyNav} aria-label="Learning journey">
          {progress.steps.map((step, index) => (
            <div className={styles.journeyStep} data-state={step.state} key={step.id}>
              <span className={styles.journeyIndex}>{step.state === "complete" ? "✓" : index + 1}</span>
              <span>{step.label}</span>
            </div>
          ))}
        </nav>

        {message ? <div className={styles.messageBanner} role="status">{message}</div> : null}
        {error ? (
          <div className={styles.errorBanner} role="alert">
            <span>{error}</span>
            <button disabled={pending} onClick={retry} type="button">Retry same receipt</button>
          </div>
        ) : null}

        <div className={styles.experienceGrid}>
          <section className={`${styles.stage} ${pending ? styles.stageBusy : ""}`} aria-busy={pending}>
            <CodexActionProvider command={command} emit={emit} pending={pending}>
              <TamboReceiptRenderer command={command} />
            </CodexActionProvider>
            {pending ? (
              <div className={styles.pendingVeil} aria-live="polite">
                <div className={styles.pendingCard}>
                  <div className={styles.pulseLine} />
                  <strong>{pendingState.title}</strong>
                  <p>{pendingState.detail}</p>
                </div>
              </div>
            ) : null}
          </section>
          <ReceiptRail progress={progress} receipts={receipts} />
        </div>
      </div>
    </main>
  );
}
