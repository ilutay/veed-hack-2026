import { useCodexAction } from "../../codex/CodexActionProvider";
import type { TargetedRetryGymProps } from "../schemas";

export function TargetedRetryGym({
  probeId,
  skill,
  hint,
  attemptsRemaining,
}: Partial<TargetedRetryGymProps>) {
  const { emit, episodeId, turnId } = useCodexAction();

  if (!probeId || !hint) {
    return <div data-testid="retry-pending">Loading retry…</div>;
  }

  const exhausted = (attemptsRemaining ?? 0) <= 0;

  return (
    <section data-testid="targeted-retry-gym" data-probe-id={probeId}>
      <p data-testid="retry-skill">{skill ?? "unclassified"}</p>
      <p data-testid="retry-hint">{hint}</p>
      <p data-testid="retry-attempts">{attemptsRemaining ?? 0}</p>
      <button
        type="button"
        disabled={exhausted}
        onClick={() =>
          emit({
            component: "TargetedRetryGym",
            episodeId,
            turnId,
            action: exhausted ? "retry.exhausted" : "retry.started",
            payload: { probeId, skill, attemptsRemaining: attemptsRemaining ?? 0 },
          })
        }
      >
        {exhausted ? "No attempts left" : "Retry"}
      </button>
    </section>
  );
}
