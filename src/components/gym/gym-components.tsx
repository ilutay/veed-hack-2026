"use client";

import {
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import type {
  CompareArenaProps,
  Confidence,
  CreditAssignmentReplayProps,
  LayerOrderTransferGymProps,
  LearningPromptProps,
  SafeExerciseFallbackProps,
  StimulusVariant,
  TargetedRetryGymProps,
} from "@/lib/tambo/gym-contract";

import { useCodexActions } from "./codex-action-context";
import styles from "./gym.module.css";

function ArrowIcon({ direction = "right" }: { direction?: "right" | "up" | "down" }) {
  const rotation = direction === "up" ? -90 : direction === "down" ? 90 : 0;

  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      viewBox="0 0 20 20"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M3.5 10h12M11 5.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className={styles.icon} viewBox="0 0 20 20">
      <path d="m4 10.5 3.5 3.5L16 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" className={styles.icon} viewBox="0 0 20 20">
      <path d="M10 2.4 16 5v4.4c0 3.7-2.4 6.8-6 8.2-3.6-1.4-6-4.5-6-8.2V5l6-2.6Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="m7.2 10 1.8 1.8 3.9-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    </svg>
  );
}

function PrimaryButton({
  children,
  disabled,
  type = "button",
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button className={styles.primaryButton} disabled={disabled} onClick={onClick} type={type}>
      <span>{children}</span>
      <ArrowIcon />
    </button>
  );
}

function SectionHeader({
  phaseLabel,
  title,
  instruction,
  aside,
}: {
  phaseLabel: string;
  title: string;
  instruction: string;
  aside?: ReactNode;
}) {
  return (
    <header className={styles.sectionHeader}>
      <div>
        <p className={styles.eyebrow}>{phaseLabel}</p>
        <h1 className={styles.exerciseTitle}>{title}</h1>
        <p className={styles.exerciseIntro}>{instruction}</p>
      </div>
      {aside}
    </header>
  );
}

function ValidationReceipt({
  receipt,
}: {
  receipt: CompareArenaProps["validationReceipt"];
}) {
  return (
    <aside className={styles.validationReceipt} aria-label="Pioneer teaching-signal validation receipt">
      <span className={styles.receiptIcon}><ShieldIcon /></span>
      <span>
        <strong>P1 · {receipt.judgment}</strong>
        <small>{receipt.provenance.toUpperCase()} · {receipt.validationId}</small>
      </span>
    </aside>
  );
}

function StimulusPreview({ variant, compact = false }: { variant: StimulusVariant; compact?: boolean }) {
  const accentStyle = { "--gym-card-accent": `var(--gym-${variant.accent})` } as CSSProperties;

  return (
    <div
      className={`${styles.stimulusPreview} ${compact ? styles.stimulusCompact : ""}`}
      data-composition={variant.composition}
      style={accentStyle}
    >
      {variant.asset ? (
        // Provider assets are content-hash bound by the server command before this renderer receives them.
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.stimulusImage} src={variant.asset.src} alt={variant.asset.alt} />
      ) : (
        <>
          <div className={styles.posterGlow} />
          <div className={styles.posterObject} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className={styles.posterCopy}>
            {variant.kicker ? <span className={styles.posterKicker}>{variant.kicker}</span> : null}
            <strong>{variant.headline}</strong>
            <p>{variant.supportingCopy}</p>
            <span className={styles.posterCta}>{variant.cta}</span>
          </div>
        </>
      )}
      <span className={styles.variantLabel}>{variant.label}</span>
    </div>
  );
}

function StimulusChoices({
  variants,
  selected,
  onSelect,
  disabled,
}: {
  variants: StimulusVariant[];
  selected: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.stimulusGrid} role="radiogroup" aria-label="Choose the composition that best answers the brief">
      {variants.map((variant) => {
        const isSelected = selected === variant.id;

        return (
          <button
            aria-checked={isSelected}
            className={`${styles.stimulusChoice} ${isSelected ? styles.stimulusChoiceSelected : ""}`}
            disabled={disabled}
            key={variant.id}
            onClick={() => onSelect(variant.id)}
            role="radio"
            type="button"
          >
            <StimulusPreview variant={variant} />
            <span className={styles.choiceFooter}>
              <span className={styles.radioMark}>{isSelected ? <CheckIcon /> : null}</span>
              <span>{isSelected ? "Your decision" : `Choose ${variant.label}`}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ConfidencePicker({
  value,
  onChange,
  disabled,
}: {
  value: Confidence | null;
  onChange: (value: Confidence) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className={styles.confidenceField} disabled={disabled}>
      <legend>How confident are you?</legend>
      <div className={styles.segmentedControl}>
        {(["low", "medium", "high"] as const).map((confidence) => (
          <button
            aria-pressed={value === confidence}
            className={value === confidence ? styles.segmentActive : ""}
            key={confidence}
            onClick={() => onChange(confidence)}
            type="button"
          >
            {confidence}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ReasoningPanel({
  prompt,
  tags,
  reasoning,
  selectedTags,
  confidence,
  disabled,
  onReasoning,
  onToggleTag,
  onConfidence,
}: {
  prompt: string;
  tags: Array<{ id: string; label: string }>;
  reasoning: string;
  selectedTags: string[];
  confidence: Confidence | null;
  disabled: boolean;
  onReasoning: (value: string) => void;
  onToggleTag: (id: string) => void;
  onConfidence: (value: Confidence) => void;
}) {
  return (
    <div className={styles.reasoningPanel}>
      <label className={styles.textareaLabel}>
        <span>{prompt}</span>
        <textarea
          disabled={disabled}
          maxLength={480}
          onChange={(event) => onReasoning(event.target.value)}
          placeholder="Name the tradeoff you noticed…"
          rows={3}
          value={reasoning}
        />
      </label>
      <div className={styles.reasoningTags} aria-label="Signals you used">
        {tags.map((tag) => {
          const selected = selectedTags.includes(tag.id);

          return (
            <button
              aria-pressed={selected}
              disabled={disabled}
              key={tag.id}
              onClick={() => onToggleTag(tag.id)}
              type="button"
            >
              {selected ? <CheckIcon /> : null}
              {tag.label}
            </button>
          );
        })}
      </div>
      <ConfidencePicker disabled={disabled} onChange={onConfidence} value={confidence} />
    </div>
  );
}

function toggleInList(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

export function LearningPrompt({
  eyebrow,
  title,
  description,
  placeholder,
  submitLabel,
  examples,
  supportedEnvelope,
  sessionTimeboxSeconds,
}: LearningPromptProps) {
  const { pending, start } = useCodexActions();
  const [prompt, setPrompt] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = prompt.trim();
    if (value.length < 3 || pending) return;
    await start(value);
  };

  return (
    <section className={styles.promptFrame}>
      <div className={styles.promptIntro}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className={styles.humanPolicyNote}>
          <span className={styles.humanGlyph} aria-hidden="true">H</span>
          <span><strong>You are the policy.</strong> Every rep trains a human decision, then tests it in a changed context.</span>
        </div>
      </div>

      <form className={styles.promptForm} onSubmit={submit}>
        <div className={styles.formTopline}>
          <label htmlFor="learning-goal">What do you want to learn?</label>
          <span>{sessionTimeboxSeconds}s session</span>
        </div>
        <textarea
          autoFocus
          disabled={pending}
          id="learning-goal"
          maxLength={280}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={placeholder}
          rows={5}
          value={prompt}
        />
        <div className={styles.promptMeta}>
          <span>{prompt.length}/280</span>
          <span>{supportedEnvelope}</span>
        </div>
        <div className={styles.exampleList} aria-label="Example learning goals">
          {examples.map((example) => (
            <button disabled={pending} key={example} onClick={() => setPrompt(example)} type="button">
              {example}
            </button>
          ))}
        </div>
        <PrimaryButton disabled={pending || prompt.trim().length < 3} type="submit">
          {pending ? "Codex is shaping the goal…" : submitLabel}
        </PrimaryButton>
      </form>
    </section>
  );
}

export function CompareArena(props: CompareArenaProps) {
  const { pending, submitExercise } = useCodexActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);

  const ready = Boolean(
    selected && confidence && (reasoning.trim().length >= 3 || selectedTags.length > 0),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !confidence || !ready || pending) return;
    await submitExercise({
      actionValue: { choiceId: selected },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: selectedTags,
      statedConfidence: confidence,
    });
  };

  return (
    <form className={styles.exerciseFrame} onSubmit={submit}>
      <SectionHeader
        aside={<ValidationReceipt receipt={props.validationReceipt} />}
        instruction={props.instruction}
        phaseLabel={props.phaseLabel}
        title={props.title}
      />
      <div className={styles.briefBar}>
        <span>THE BRIEF</span>
        <p>{props.brief}</p>
        <small>{props.timeLimitSeconds}s</small>
      </div>
      <StimulusChoices disabled={pending} onSelect={setSelected} selected={selected} variants={props.variants} />
      <ReasoningPanel
        confidence={confidence}
        disabled={pending}
        onConfidence={setConfidence}
        onReasoning={setReasoning}
        onToggleTag={(id) => setSelectedTags((current) => toggleInList(current, id))}
        prompt={props.reasoningPrompt}
        reasoning={reasoning}
        selectedTags={selectedTags}
        tags={props.reasoningTags}
      />
      <div className={styles.formActions}>
        <span>Choice + reasoning + confidence become one evidence record.</span>
        <PrimaryButton disabled={!ready || pending} type="submit">
          {pending ? "Assessing response…" : props.submitLabel}
        </PrimaryButton>
      </div>
    </form>
  );
}

export function CreditAssignmentReplay(props: CreditAssignmentReplayProps) {
  const { pending, acknowledgeFeedback } = useCodexActions();

  return (
    <section className={styles.exerciseFrame}>
      <SectionHeader instruction={props.summary} phaseLabel={props.phaseLabel} title={props.title} />
      <div className={styles.replayLayout}>
        <div className={styles.annotatedArtifact}>
          <StimulusPreview compact variant={props.artifact} />
          {props.anchors.map((anchor, index) => (
            <div
              className={styles.artifactAnchor}
              data-tone={anchor.tone}
              key={anchor.id}
              style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
            >
              <span>{index + 1}</span>
              <div><strong>{anchor.label}</strong><small>{anchor.note}</small></div>
            </div>
          ))}
        </div>
        <div className={styles.evidencePanel}>
          <p className={styles.eyebrow}>CREDIT ASSIGNMENT / {props.evidenceId}</p>
          <h2>You chose {props.selectedLabel}</h2>
          <p className={styles.calibrationLine}>
            Confidence calibration: <strong>{props.confidenceCalibration}</strong>
          </p>
          <div className={styles.criteriaList}>
            {props.criteria.map((criterion) => (
              <article data-outcome={criterion.outcome} key={criterion.criterionId}>
                <span>{criterion.outcome === "met" ? <CheckIcon /> : "·"}</span>
                <div><strong>{criterion.label}</strong><p>{criterion.observation}</p></div>
              </article>
            ))}
          </div>
          <PrimaryButton disabled={pending} onClick={() => acknowledgeFeedback(props.evidenceId)}>
            {pending ? "Pioneer is locating the edge…" : props.nextLabel}
          </PrimaryButton>
        </div>
      </div>
    </section>
  );
}

export function TargetedRetryGym(props: TargetedRetryGymProps) {
  const { pending, submitExercise } = useCodexActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const ready = Boolean(selected && confidence && (reasoning.trim().length >= 3 || selectedTags.length > 0));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !confidence || !ready || pending) return;
    await submitExercise({
      actionValue: { choiceId: selected },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: selectedTags,
      statedConfidence: confidence,
    });
  };

  return (
    <form className={styles.exerciseFrame} onSubmit={submit}>
      <SectionHeader
        aside={<ValidationReceipt receipt={props.validationReceipt} />}
        instruction={props.instruction}
        phaseLabel={props.phaseLabel}
        title={props.title}
      />
      <div className={styles.adaptationReceipt}>
        <div><span>PIONEER #2 / LEARNER EDGE</span><strong>{props.targetConstraint}</strong></div>
        <p>{props.whyThisRep}</p>
        <small>From evidence {props.evidenceIds.join(", ")}</small>
      </div>
      <div className={styles.briefBar}><span>FRESH STIMULUS</span><p>{props.brief}</p></div>
      <StimulusChoices disabled={pending} onSelect={setSelected} selected={selected} variants={props.variants} />
      <ReasoningPanel
        confidence={confidence}
        disabled={pending}
        onConfidence={setConfidence}
        onReasoning={setReasoning}
        onToggleTag={(id) => setSelectedTags((current) => toggleInList(current, id))}
        prompt={props.reasoningPrompt}
        reasoning={reasoning}
        selectedTags={selectedTags}
        tags={props.reasoningTags}
      />
      <div className={styles.formActions}>
        <span>Retry can improve the evidence. It cannot prove transfer.</span>
        <PrimaryButton disabled={!ready || pending} type="submit">{pending ? "Scoring fresh evidence…" : props.submitLabel}</PrimaryButton>
      </div>
    </form>
  );
}

export function LayerOrderTransferGym(props: LayerOrderTransferGymProps) {
  const { pending, submitExercise } = useCodexActions();
  const [order, setOrder] = useState(() => props.layers.map((layer) => layer.id));
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const layerById = useMemo(() => new Map(props.layers.map((layer) => [layer.id, layer])), [props.layers]);

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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confidence || !ready || pending) return;
    await submitExercise({
      actionValue: { layerOrder: order },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: [],
      statedConfidence: confidence,
    });
  };

  return (
    <form className={styles.exerciseFrame} onSubmit={submit}>
      <SectionHeader
        aside={<ValidationReceipt receipt={props.validationReceipt} />}
        instruction={props.instruction}
        phaseLabel={props.phaseLabel}
        title={props.title}
      />
      <div className={styles.transferDistance}>
        <span>HELD-OUT / {props.transferLabel}</span>
        <p><strong>Context changed:</strong> {props.changedContext}</p>
        <p><strong>Action changed:</strong> {props.changedAction}</p>
      </div>
      <div className={styles.transferLayout}>
        <div className={styles.layerEditor}>
          <div className={styles.briefBar}><span>TARGET BRIEF</span><p>{props.targetBrief}</p></div>
          <ol>
            {order.map((layerId, index) => {
              const layer = layerById.get(layerId);
              if (!layer) return null;
              return (
                <li key={layer.id}>
                  <span className={styles.layerRank}>{index + 1}</span>
                  <span><strong>{layer.label}</strong><small>{layer.role}</small></span>
                  <div className={styles.reorderButtons}>
                    <button aria-label={`Move ${layer.label} up`} disabled={pending || index === 0} onClick={() => move(index, -1)} type="button"><ArrowIcon direction="up" /></button>
                    <button aria-label={`Move ${layer.label} down`} disabled={pending || index === order.length - 1} onClick={() => move(index, 1)} type="button"><ArrowIcon direction="down" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className={styles.transferPreview} aria-label="Layer-order preview">
          <span className={styles.previewBadge}>9:16 / CHANGED CONTEXT</span>
          {order.map((layerId, index) => {
            const layer = layerById.get(layerId);
            if (!layer) return null;
            return <div data-role={layer.role} key={layer.id} style={{ opacity: Math.max(0.52, 1 - index * 0.08) }}><small>{index + 1}</small>{layer.copy}</div>;
          })}
        </div>
      </div>
      <div className={styles.reasoningPanel}>
        <label className={styles.textareaLabel}>
          <span>Why does this order answer the brief?</span>
          <textarea disabled={pending} maxLength={480} onChange={(event) => setReasoning(event.target.value)} rows={3} value={reasoning} />
        </label>
        <ConfidencePicker disabled={pending} onChange={setConfidence} value={confidence} />
      </div>
      <div className={styles.formActions}>
        <span>Only this changed-context action can show transfer in this session.</span>
        <PrimaryButton disabled={!ready || pending} type="submit">{pending ? "Checking transfer…" : props.submitLabel}</PrimaryButton>
      </div>
    </form>
  );
}

export function SafeExerciseFallback(props: SafeExerciseFallbackProps) {
  const { pending, submitExercise } = useCodexActions();
  const [selected, setSelected] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const ready = Boolean(selected && confidence && reasoning.trim().length >= 3);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !confidence || !ready || pending) return;
    await submitExercise({
      actionValue: { choiceId: selected },
      responseContract: props.responseContract,
      reasoningText: reasoning,
      reasoningTagIds: [],
      statedConfidence: confidence,
    });
  };

  return (
    <form className={styles.exerciseFrame} onSubmit={submit}>
      <SectionHeader
        aside={<ValidationReceipt receipt={props.validationReceipt} />}
        instruction={props.instruction}
        phaseLabel={props.phaseLabel}
        title={props.title}
      />
      <div className={styles.fallbackDisclosure}><ShieldIcon /><p><strong>Safe-path disclosure</strong>{props.disclosure}</p></div>
      <div className={styles.briefBar}><span>THE BRIEF</span><p>{props.brief}</p></div>
      <fieldset className={styles.fallbackOptions} disabled={pending}>
        <legend>{props.prompt}</legend>
        {props.options.map((option) => (
          <label data-selected={selected === option.id} key={option.id}>
            <input checked={selected === option.id} name="fallback-option" onChange={() => setSelected(option.id)} type="radio" value={option.id} />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </fieldset>
      <div className={styles.reasoningPanel}>
        <label className={styles.textareaLabel}><span>What signal drove your decision?</span><textarea disabled={pending} maxLength={480} onChange={(event) => setReasoning(event.target.value)} rows={3} value={reasoning} /></label>
        <ConfidencePicker disabled={pending} onChange={setConfidence} value={confidence} />
      </div>
      <div className={styles.formActions}>
        <span>This is a separately validated fixture, not a replayed live result.</span>
        <PrimaryButton disabled={!ready || pending} type="submit">{pending ? "Recording response…" : props.submitLabel}</PrimaryButton>
      </div>
    </form>
  );
}
