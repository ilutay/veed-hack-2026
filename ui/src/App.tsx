import { useCallback, useEffect, useRef, useState } from "react";
import { GymRuntime } from "./gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./gym/GymBlock";
import type { CodexGymEvent } from "./codex/CodexActionProvider";
import { requestNextBlock, describeEvent } from "./codex/client";

const OPENING_STATE =
  "Brand new learner. Nothing measured yet. Target skill: attention-routing in transformers.";

/**
 * The closed loop: Codex decides which gym surface to show, the Tambo registry
 * renders it, the learner's interaction goes back to Codex, which decides the
 * next surface.
 */
export function App() {
  const [command, setCommand] = useState<CodexComponentCommand | null>(null);
  const [events, setEvents] = useState<CodexGymEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const turn = useRef(0);

  const advance = useCallback(async (state: string) => {
    setBusy(true);
    setError(null);
    turn.current += 1;
    try {
      setCommand(
        await requestNextBlock({
          episodeId: "ep-local",
          turnId: `turn-${turn.current}`,
          state,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void advance(OPENING_STATE);
  }, [advance]);

  const onEvent = useCallback(
    (event: CodexGymEvent) => {
      setEvents((prev) => [...prev, event]);
      void advance(describeEvent(event));
    },
    [advance],
  );

  return (
    <GymRuntime>
      <main style={{ fontFamily: "system-ui", maxWidth: 760, margin: "2rem auto" }}>
        <h1>Pioneer Gym — Codex-driven</h1>
        <p data-testid="status">
          {busy ? "Codex is choosing the next exercise…" : `turn ${turn.current}`}
        </p>
        {error && (
          <p data-testid="bridge-error" role="alert" style={{ color: "crimson" }}>
            Bridge error: {error}
          </p>
        )}
        {command && (
          <GymBlock
            key={command.componentId}
            command={command}
            onEvent={onEvent}
            pending={<p>Preparing exercise…</p>}
          />
        )}
        <h2>Emitted to Codex</h2>
        <pre data-testid="event-log">{JSON.stringify(events, null, 2)}</pre>
      </main>
    </GymRuntime>
  );
}
