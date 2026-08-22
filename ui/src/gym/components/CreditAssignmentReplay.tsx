import { useCodexAction } from "../../codex/CodexActionProvider";
import type { CreditAssignmentReplayProps, EvidenceSpanSchema } from "../schemas";
import type { z } from "zod";

type Span = z.infer<typeof EvidenceSpanSchema>;

/**
 * Slices the response into evidence-backed segments. Spans are clamped and
 * sorted here because Codex emits them in whatever order Pioneer scored them,
 * and an out-of-range span would otherwise blank the transcript.
 */
function segment(text: string, spans: Span[]) {
  const ordered = [...spans]
    .filter((s) => s.start < s.end && s.start < text.length)
    .map((s) => ({ ...s, end: Math.min(s.end, text.length) }))
    .sort((a, b) => a.start - b.start);

  const out: Array<{ text: string; span?: Span }> = [];
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor) continue; // drop overlaps rather than double-render
    if (span.start > cursor) out.push({ text: text.slice(cursor, span.start) });
    out.push({ text: text.slice(span.start, span.end), span });
    cursor = span.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

export function CreditAssignmentReplay({
  probeId,
  responseText,
  spans,
  score,
}: Partial<CreditAssignmentReplayProps>) {
  const { emit, episodeId, turnId } = useCodexAction();

  if (!probeId || typeof responseText !== "string") {
    return <div data-testid="replay-pending">Loading replay…</div>;
  }

  const segments = segment(responseText, spans ?? []);

  return (
    <section data-testid="credit-assignment-replay" data-probe-id={probeId}>
      <p data-testid="replay-score">{score ?? 0}</p>
      <p>
        {segments.map((seg, i) => (
          <span
            key={i}
            data-verdict={seg.span?.verdict}
            title={seg.span?.note}
          >
            {seg.text}
          </span>
        ))}
      </p>
      <button
        type="button"
        onClick={() =>
          emit({
            component: "CreditAssignmentReplay",
            episodeId,
            turnId,
            action: "replay.acknowledged",
            payload: { probeId, score: score ?? 0 },
          })
        }
      >
        Continue
      </button>
    </section>
  );
}
