import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import type {
  CodexUiCommand,
  CompareArenaProps,
  Confidence,
  CreditAssignmentReplayProps,
  ExerciseSubmissionDraft,
  GymApiRequest,
  JourneyProgress,
  LayerOrderTransferGymProps,
  LearningPromptProps,
  SafeExerciseFallbackProps,
  TargetedRetryGymProps,
  UiReceipt,
} from "../../../src/lib/tambo/gym-contract";
import {
  buildExerciseSubmittedEvent,
  buildFeedbackAcknowledgedEvent,
  buildStartEvent,
  checkAccess,
  createBrowserSessionId,
  isUnauthorizedError,
  postGym,
  unlockAccess,
  type VerifiedGymApiResponse,
} from "./client";

type CanonicalProps =
  | LearningPromptProps
  | CompareArenaProps
  | CreditAssignmentReplayProps
  | TargetedRetryGymProps
  | LayerOrderTransferGymProps
  | SafeExerciseFallbackProps;

interface PanelState {
  command: CodexUiCommand;
  verifiedProps: CanonicalProps;
  receipts: UiReceipt[];
  progress?: JourneyProgress;
  message?: string;
}

export interface NovelGymPanelProps {
  initialPrompt: string;
  onComplete?: () => void;
}

const learningPromptProps: LearningPromptProps = {
  eyebrow: "PIONEER GYM / HUMAN PRACTICE",
  title: "Practice what you just learned",
  description:
    "Turn the topic into a short decision, explain what you noticed, and test whether the judgment transfers.",
  placeholder: "What do you want to get better at?",
  submitLabel: "Build my first rep",
  examples: [
    "Spot weak visual hierarchy",
    "Make creative choices I can defend",
    "Know what to simplify in a crowded frame",
  ],
  supportedEnvelope: "A focused practice session takes about 90 seconds.",
  sessionTimeboxSeconds: 90,
};

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
}

function createBootstrapCommand(): CodexUiCommand {
  const sessionId = createBrowserSessionId();
  return {
    commandKind: "shell",
    commandId: createId("command"),
    sessionId,
    issuedBy: "codex",
    component: {
      type: "component",
      id: createId("component"),
      name: "LearningPrompt",
      props: learningPromptProps,
      streamingState: "done",
    },
    componentSchemaVersion: "learning-prompt-v1",
    issuedAt: new Date().toISOString(),
  };
}

function bootstrapState(): PanelState {
  return {
    command: createBootstrapCommand(),
    verifiedProps: learningPromptProps,
    receipts: [],
  };
}

function isUnauthorized(error: unknown) {
  if (isUnauthorizedError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown };
  return candidate.status === 401 || candidate.code === "access_denied";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The practice request failed.";
}

export function NovelGymPanel({ initialPrompt, onComplete }: NovelGymPanelProps) {
  const [access, setAccess] = useState<"checking" | "locked" | "ready">("checking");
  const [accessCode, setAccessCode] = useState("");
  const [panel, setPanel] = useState<PanelState>(bootstrapState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completionReady, setCompletionReady] = useState(false);
  const lastRequest = useRef<GymApiRequest | null>(null);
  const completionDelivered = useRef(false);

  useEffect(() => {
    let current = true;
    void checkAccess()
      .then(({ authenticated }) => {
        if (current) setAccess(authenticated ? "ready" : "locked");
      })
      .catch((caught) => {
        if (!current) return;
        if (isUnauthorized(caught)) {
          setAccess("locked");
          return;
        }
        setError(errorMessage(caught));
        setAccess("locked");
      });
    return () => {
      current = false;
    };
  }, []);

  const acceptResponse = useCallback((response: VerifiedGymApiResponse) => {
    setPanel({
      command: response.command,
    verifiedProps: response.verifiedProps as CanonicalProps,
      receipts: response.receipts,
      progress: response.progress,
      message: response.message,
    });
  }, []);

  const sendRequest = useCallback(
    async (request: GymApiRequest) => {
      setPending(true);
      setError(null);
      lastRequest.current = request;
      try {
        const response = await postGym(request);
        acceptResponse(response);
        if (request.event.type === "feedback.acknowledged" && response.progress?.learningStatus === "transfer_shown") {
          setCompletionReady(true);
        }
      } catch (caught) {
        if (isUnauthorized(caught)) {
          setAccess("locked");
          setError("Session access expired. Enter the access code to continue.");
        } else {
          setError(errorMessage(caught));
        }
      } finally {
        setPending(false);
      }
    },
    [acceptResponse],
  );

  const submitAccessCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!accessCode.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await unlockAccess(accessCode.trim());
      setAccessCode("");
      setAccess("ready");
    } catch (caught) {
      setAccess("locked");
      setError(isUnauthorized(caught) ? "That access code was not accepted." : errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const start = async (rawPrompt: string) => {
    try {
      const event = buildStartEvent(panel.command, rawPrompt);
      await sendRequest({ sessionId: panel.command.sessionId, event });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const submitExercise = async (draft: ExerciseSubmissionDraft) => {
    if (panel.command.commandKind !== "exercise") {
      setError("The visible practice command cannot accept an exercise response.");
      return;
    }
    try {
      const event = buildExerciseSubmittedEvent(panel.command, draft);
      await sendRequest({ sessionId: panel.command.sessionId, event });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const acknowledgeFeedback = async (evidenceId: string) => {
    if (panel.command.commandKind !== "exercise") {
      setError("The visible command has no feedback evidence to acknowledge.");
      return;
    }
    try {
      const event = buildFeedbackAcknowledgedEvent(panel.command, evidenceId);
      await sendRequest({ sessionId: panel.command.sessionId, event });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const retry = () => {
    if (lastRequest.current) void sendRequest(lastRequest.current);
  };

  const complete = () => {
    if (completionDelivered.current) return;
    completionDelivered.current = true;
    if (onComplete) {
      onComplete();
      return;
    }
    lastRequest.current = null;
    setCompletionReady(false);
    setPanel(bootstrapState());
    completionDelivered.current = false;
  };

  if (access === "checking") {
    return (
      <section aria-busy="true" aria-live="polite" data-testid="novel-gym-panel" style={styles.panel}>
        <p className="receipt">Preparing a private practice session…</p>
      </section>
    );
  }

  if (access === "locked") {
    return (
      <section data-testid="novel-gym-panel" style={styles.panel}>
        <p className="receipt">Private practice</p>
        <h2 className="display">Enter the access code</h2>
        <p className="objective">This practice session is protected.</p>
        {error ? <p role="alert" style={styles.error}>{error}</p> : null}
        <form className="composer" onSubmit={submitAccessCode}>
          <div className="composer-row">
            <label style={styles.grow}>
              <span style={styles.srOnly}>Access code</span>
              <input
                autoComplete="one-time-code"
                autoFocus
                disabled={pending}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Access code"
                type="password"
                value={accessCode}
              />
            </label>
            <button className="btn btn-primary" disabled={pending || !accessCode.trim()} type="submit">
              {pending ? "Checking…" : "Unlock"}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section aria-busy={pending} data-testid="novel-gym-panel" style={styles.panel}>
      <header style={styles.header}>
        <div>
          <p className="receipt">Adaptive practice</p>
          <h2 className="display" style={styles.heading}>Try it yourself</h2>
        </div>
        <span className="receipt" data-testid="gym-command-name">{panel.command.component.name}</span>
      </header>

      <ProgressStrip progress={panel.progress} />
      {panel.message ? <p aria-live="polite" style={styles.message}>{panel.message}</p> : null}
      {error ? (
        <div role="alert" style={styles.errorRow}>
          <span>{error}</span>
          {lastRequest.current ? <button className="btn" disabled={pending} onClick={retry} type="button">Retry</button> : null}
        </div>
      ) : null}

      {completionReady ? (
        <div data-testid="gym-complete" style={styles.complete}>
          <h3 style={styles.cardHeading}>Practice complete</h3>
          <p>You tested the judgment in a changed context and acknowledged the final evidence.</p>
          <button className="btn btn-primary" disabled={completionDelivered.current} onClick={complete} type="button">
            Continue
          </button>
        </div>
      ) : (
        <CanonicalComponent
          command={panel.command}
          initialPrompt={initialPrompt}
          key={panel.command.component.id}
          onAcknowledge={acknowledgeFeedback}
          onStart={start}
          onSubmit={submitExercise}
          pending={pending}
          props={panel.verifiedProps}
        />
      )}

      <ReceiptSummary receipts={panel.receipts} />
    </section>
  );
}

function ProgressStrip({ progress }: { progress?: JourneyProgress }) {
  if (!progress) return null;
  return (
    <ol aria-label="Practice progress" style={styles.progress}>
      {progress.steps.map((step) => (
        <li aria-current={step.state === "active" ? "step" : undefined} key={step.id} style={styles.progressItem}>
          <span aria-hidden="true">{step.state === "complete" ? "✓" : "·"}</span> {step.label}
        </li>
      ))}
    </ol>
  );
}

function ReceiptSummary({ receipts }: { receipts: UiReceipt[] }) {
  if (receipts.length === 0) return null;
  return (
    <details style={styles.receipts}>
      <summary>Evidence receipts ({receipts.length})</summary>
      <ul style={styles.list}>
        {receipts.map((receipt) => (
          <li key={receipt.id}>
            <strong>{receipt.title}</strong> — {receipt.status} · {receipt.provenance}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface CanonicalComponentProps {
  command: CodexUiCommand;
  props: CanonicalProps;
  initialPrompt: string;
  pending: boolean;
  onStart: (prompt: string) => Promise<void>;
  onSubmit: (draft: ExerciseSubmissionDraft) => Promise<void>;
  onAcknowledge: (evidenceId: string) => Promise<void>;
}

function CanonicalComponent(input: CanonicalComponentProps) {
  switch (input.command.component.name) {
    case "LearningPrompt":
      return <LearningPromptView {...input} props={input.props as LearningPromptProps} />;
    case "CompareArena":
      return <ChoiceExerciseView {...input} props={input.props as CompareArenaProps} />;
    case "CreditAssignmentReplay":
      return <FeedbackView {...input} props={input.props as CreditAssignmentReplayProps} />;
    case "TargetedRetryGym":
      return <ChoiceExerciseView {...input} props={input.props as TargetedRetryGymProps} />;
    case "LayerOrderTransferGym":
      return <LayerOrderView {...input} props={input.props as LayerOrderTransferGymProps} />;
    case "SafeExerciseFallback":
      return <FallbackView {...input} props={input.props as SafeExerciseFallbackProps} />;
  }
}

function LearningPromptView({
  props,
  initialPrompt,
  pending,
  onStart,
}: CanonicalComponentProps & { props: LearningPromptProps }) {
  const [prompt, setPrompt] = useState(initialPrompt.slice(0, 280));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (prompt.trim().length >= 3 && !pending) void onStart(prompt.trim());
  };
  return (
    <form className="composer" data-testid="LearningPrompt" onSubmit={submit} style={styles.card}>
      <p className="receipt">{props.eyebrow}</p>
      <h3 style={styles.cardHeading}>{props.title}</h3>
      <p>{props.description}</p>
      <label className="field-label">
        Learning goal
        <textarea
          autoFocus
          disabled={pending}
          maxLength={280}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={props.placeholder}
          rows={4}
          value={prompt}
        />
      </label>
      <div aria-label="Example learning goals" className="taste">
        {props.examples.map((example) => (
          <button className="taste-chip" disabled={pending} key={example} onClick={() => setPrompt(example)} type="button">
            {example}
          </button>
        ))}
      </div>
      <p className="timing-note">{props.supportedEnvelope} · {props.sessionTimeboxSeconds}s</p>
      <button className="btn btn-primary" disabled={pending || prompt.trim().length < 3} type="submit">
        {pending ? "Building…" : props.submitLabel}
      </button>
    </form>
  );
}

type ChoiceProps = CompareArenaProps | TargetedRetryGymProps;

function ChoiceExerciseView({
  props,
  pending,
  onSubmit,
}: CanonicalComponentProps & { props: ChoiceProps }) {
  const [choiceId, setChoiceId] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | "">("");
  const ready = Boolean(choiceId && confidence && (reasoning.trim().length >= 3 || tagIds.length > 0));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !confidence || pending) return;
    void onSubmit({
      actionValue: { choiceId },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: tagIds,
      statedConfidence: confidence,
    });
  };
  return (
    <form data-testid={"targetConstraint" in props ? "TargetedRetryGym" : "CompareArena"} onSubmit={submit} style={styles.card}>
      <ExerciseHeader props={props} />
      {"targetConstraint" in props ? (
        <aside style={styles.message}>
          <strong>{props.targetConstraint}</strong>
          <p>{props.whyThisRep}</p>
        </aside>
      ) : null}
      <fieldset className="quiz-q" disabled={pending}>
        <legend>Choose one</legend>
        <div className="quiz-choices">
          {props.variants.map((variant) => (
            <label className="choice" key={variant.id} style={styles.radioCard}>
              <input
                checked={choiceId === variant.id}
                name={`choice-${props.responseContract.schemaId}`}
                onChange={() => setChoiceId(variant.id)}
                type="radio"
                value={variant.id}
              />
              <span><strong>{variant.label}: {variant.headline}</strong><small style={styles.blockText}>{variant.supportingCopy} · {variant.cta}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <ReasoningFields
        confidence={confidence}
        disabled={pending}
        onConfidence={setConfidence}
        onReasoning={setReasoning}
        onTag={(id) => setTagIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
        prompt={props.reasoningPrompt}
        reasoning={reasoning}
        selectedTags={tagIds}
        tags={props.reasoningTags}
      />
      <button className="btn btn-primary" disabled={!ready || pending} type="submit">
        {pending ? "Assessing…" : props.submitLabel}
      </button>
    </form>
  );
}

function FeedbackView({
  props,
  pending,
  onAcknowledge,
}: CanonicalComponentProps & { props: CreditAssignmentReplayProps }) {
  return (
    <article data-testid="CreditAssignmentReplay" style={styles.card}>
      <p className="receipt">{props.phaseLabel}</p>
      <h3 style={styles.cardHeading}>{props.title}</h3>
      <p>{props.summary}</p>
      <p><strong>You chose:</strong> {props.selectedLabel}</p>
      <p><strong>Confidence:</strong> {props.confidenceCalibration}</p>
      <ul style={styles.list}>
        {props.criteria.map((criterion) => (
          <li key={criterion.criterionId}>
            <strong>{criterion.label} · {criterion.outcome}</strong><br />{criterion.observation}
          </li>
        ))}
      </ul>
      <details>
        <summary>Evidence anchors</summary>
        <ul style={styles.list}>
          {props.anchors.map((anchor) => <li key={anchor.id}><strong>{anchor.label}</strong> — {anchor.note}</li>)}
        </ul>
      </details>
      <button className="btn btn-primary" disabled={pending} onClick={() => void onAcknowledge(props.evidenceId)} type="button">
        {pending ? "Adapting…" : props.nextLabel}
      </button>
    </article>
  );
}

function LayerOrderView({
  props,
  pending,
  onSubmit,
}: CanonicalComponentProps & { props: LayerOrderTransferGymProps }) {
  const [order, setOrder] = useState(() => props.layers.map((layer) => layer.id));
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<Confidence | "">("");
  const byId = new Map(props.layers.map((layer) => [layer.id, layer]));
  const move = (index: number, delta: -1 | 1) => {
    setOrder((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const ready = Boolean(confidence && reasoning.trim().length >= 3);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !confidence || pending) return;
    void onSubmit({
      actionValue: { layerOrder: order },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: [],
      statedConfidence: confidence,
    });
  };
  return (
    <form data-testid="LayerOrderTransferGym" onSubmit={submit} style={styles.card}>
      <ExerciseHeader props={props} />
      <aside style={styles.message}>
        <strong>{props.transferLabel}</strong>
        <p>Changed context: {props.changedContext}</p>
        <p>Changed action: {props.changedAction}</p>
      </aside>
      <p>{props.targetBrief}</p>
      <ol style={styles.list}>
        {order.map((id, index) => {
          const layer = byId.get(id);
          if (!layer) return null;
          return (
            <li key={id} style={styles.orderRow}>
              <span><strong>{index + 1}. {layer.label}</strong><small style={styles.blockText}>{layer.copy}</small></span>
              <span>
                <button aria-label={`Move ${layer.label} up`} className="btn" disabled={pending || index === 0} onClick={() => move(index, -1)} type="button">↑</button>
                <button aria-label={`Move ${layer.label} down`} className="btn" disabled={pending || index === order.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
              </span>
            </li>
          );
        })}
      </ol>
      <ReasoningFields
        confidence={confidence}
        disabled={pending}
        onConfidence={setConfidence}
        onReasoning={setReasoning}
        prompt="Why does this order answer the brief?"
        reasoning={reasoning}
        selectedTags={[]}
        tags={[]}
      />
      <button className="btn btn-primary" disabled={!ready || pending} type="submit">
        {pending ? "Checking…" : props.submitLabel}
      </button>
    </form>
  );
}

function FallbackView({
  props,
  pending,
  onSubmit,
}: CanonicalComponentProps & { props: SafeExerciseFallbackProps }) {
  const [choiceId, setChoiceId] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<Confidence | "">("");
  const ready = Boolean(choiceId && confidence && reasoning.trim().length >= 3);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !confidence || pending) return;
    void onSubmit({
      actionValue: { choiceId },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: [],
      statedConfidence: confidence,
    });
  };
  return (
    <form data-testid="SafeExerciseFallback" onSubmit={submit} style={styles.card}>
      <ExerciseHeader props={props} />
      <p role="note" style={styles.message}><strong>Accessible fallback:</strong> {props.disclosure}</p>
      <fieldset className="quiz-q" disabled={pending}>
        <legend>{props.prompt}</legend>
        <div className="quiz-choices">
          {props.options.map((option) => (
            <label className="choice" key={option.id} style={styles.radioCard}>
              <input checked={choiceId === option.id} name="fallback-choice" onChange={() => setChoiceId(option.id)} type="radio" value={option.id} />
              <span><strong>{option.label}</strong><small style={styles.blockText}>{option.description}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <ReasoningFields
        confidence={confidence}
        disabled={pending}
        onConfidence={setConfidence}
        onReasoning={setReasoning}
        prompt="What signal drove your decision?"
        reasoning={reasoning}
        selectedTags={[]}
        tags={[]}
      />
      <button className="btn btn-primary" disabled={!ready || pending} type="submit">
        {pending ? "Recording…" : props.submitLabel}
      </button>
    </form>
  );
}

function ExerciseHeader({ props }: { props: ChoiceProps | LayerOrderTransferGymProps | SafeExerciseFallbackProps }) {
  return (
    <header>
      <p className="receipt">{props.phaseLabel} · {props.validationReceipt.sourceLabel}</p>
      <h3 style={styles.cardHeading}>{props.title}</h3>
      <p>{props.instruction}</p>
      <p style={styles.message}><strong>Brief:</strong> {props.brief}</p>
    </header>
  );
}

interface ReasoningFieldsProps {
  prompt: string;
  reasoning: string;
  confidence: Confidence | "";
  tags: Array<{ id: string; label: string }>;
  selectedTags: string[];
  disabled: boolean;
  onReasoning: (value: string) => void;
  onConfidence: (value: Confidence | "") => void;
  onTag?: (id: string) => void;
}

function ReasoningFields({
  prompt,
  reasoning,
  confidence,
  tags,
  selectedTags,
  disabled,
  onReasoning,
  onConfidence,
  onTag,
}: ReasoningFieldsProps) {
  return (
    <div>
      <label className="field-label">
        {prompt}
        <textarea disabled={disabled} maxLength={1_200} onChange={(event) => onReasoning(event.target.value)} rows={3} value={reasoning} />
      </label>
      {tags.length ? (
        <fieldset className="quiz-q" disabled={disabled}>
          <legend>Signals you used</legend>
          <div className="taste">
            {tags.map((tag) => (
              <label className="taste-chip" key={tag.id}>
                <input checked={selectedTags.includes(tag.id)} onChange={() => onTag?.(tag.id)} type="checkbox" /> {tag.label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="field-label">
        Confidence
        <select disabled={disabled} onChange={(event) => onConfidence(event.target.value as Confidence | "")} value={confidence}>
          <option value="">Choose confidence</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 20, margin: "24px 0", background: "var(--surface)" },
  header: { display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16, marginBottom: 16 },
  heading: { margin: 0 },
  card: { border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 20, background: "var(--canvas)" },
  cardHeading: { margin: "0 0 8px", fontSize: "1.35rem" },
  message: { borderLeft: "3px solid var(--text-main)", padding: "8px 12px", background: "var(--surface)" },
  error: { color: "crimson" },
  errorRow: { color: "crimson", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  complete: { border: "1px solid var(--border-strong)", padding: 20, background: "var(--canvas)" },
  progress: { listStyle: "none", display: "flex", flexWrap: "wrap", gap: 12, padding: 0, margin: "0 0 16px", fontFamily: "var(--font-mono)", fontSize: ".72rem", textTransform: "uppercase" },
  progressItem: { display: "inline-flex", gap: 4 },
  receipts: { marginTop: 16, fontSize: ".8rem" },
  list: { paddingLeft: 20 },
  radioCard: { display: "flex", alignItems: "start", gap: 10, width: "100%", textAlign: "left" },
  blockText: { display: "block", color: "var(--text-muted)", marginTop: 4 },
  orderRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 },
  grow: { flex: "1 1 240px" },
  srOnly: { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 },
};
