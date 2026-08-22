import { useState } from "react";
import { GymRuntime } from "./gym/GymRuntime";
import { GymBlock, type CodexComponentCommand } from "./gym/GymBlock";
import type { CodexGymEvent } from "./codex/CodexActionProvider";

/**
 * Local harness. Stands in for Codex: it holds a component command and logs the
 * events a real Codex would answer with the next block.
 */
const SEED: CodexComponentCommand = {
  componentId: "cmp-0001",
  componentName: "ProbeArena",
  episodeId: "ep-local",
  turnId: "turn-1",
  props: {
    probeId: "probe-attn-01",
    skill: "attention-routing",
    prompt: "Which layer first attends across sequence positions?",
    choices: [
      { id: "a", label: "The embedding layer" },
      { id: "b", label: "The first self-attention block" },
      { id: "c", label: "The output projection" },
    ],
  },
};

export function App() {
  const [events, setEvents] = useState<CodexGymEvent[]>([]);

  return (
    <GymRuntime>
      <main>
        <h1>Pioneer Gym — local runtime</h1>
        <GymBlock
          command={SEED}
          onEvent={(e) => setEvents((prev) => [...prev, e])}
        />
        <h2>Emitted to Codex</h2>
        <pre data-testid="event-log">{JSON.stringify(events, null, 2)}</pre>
      </main>
    </GymRuntime>
  );
}
