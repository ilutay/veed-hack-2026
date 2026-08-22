import type { CodexComponentCommand } from "../gym/GymBlock";
import type { CodexGymEvent } from "./CodexActionProvider";

/**
 * Asks Codex what to render next.
 *
 * The browser never talks to codex-cli directly — the bridge owns that, and
 * with it the auth file and the output schema. This is the only network call
 * the gym makes; Tambo makes none.
 */
export async function requestNextBlock(input: {
  episodeId: string;
  turnId: string;
  state: string;
  signal?: AbortSignal;
}): Promise<CodexComponentCommand> {
  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      episodeId: input.episodeId,
      turnId: input.turnId,
      state: input.state,
    }),
    signal: input.signal,
  });

  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `bridge: HTTP ${res.status}`);
  return body as CodexComponentCommand;
}

/** Renders a learner event as the state string for the next Codex turn. */
export function describeEvent(event: CodexGymEvent): string {
  return `The learner just interacted with ${event.component}: action=${
    event.action
  }, detail=${JSON.stringify(event.payload)}. Decide what to show next.`;
}
