import { useCodexAction } from "../../codex/CodexActionProvider";
import type { ProbeArenaProps } from "../schemas";

/**
 * Props arrive from Codex and may be partial while a block streams, so every
 * field is read defensively. ComponentRenderer parses partial JSON and renders
 * on every tick — a bare `choices.map` throws on the first one.
 */
export function ProbeArena({ probeId, prompt, choices, skill }: Partial<ProbeArenaProps>) {
  const { emit, episodeId, turnId } = useCodexAction();

  if (!probeId || !prompt || !choices?.length) {
    return <div data-testid="probe-arena-pending">Loading probe…</div>;
  }

  return (
    <section data-testid="probe-arena" data-probe-id={probeId}>
      <p data-testid="probe-skill">{skill ?? "unclassified"}</p>
      <h2>{prompt}</h2>
      <ul>
        {choices.map((choice) => (
          <li key={choice.id}>
            <button
              type="button"
              onClick={() =>
                emit({
                  component: "ProbeArena",
                  episodeId,
                  turnId,
                  action: "probe.answered",
                  payload: { probeId, choiceId: choice.id, skill },
                })
              }
            >
              {choice.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
