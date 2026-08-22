import type { CodexComponentCommand } from "../gym/GymBlock";

/** One entry in the chat transcript. */
export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  /** Prose shown for the message. Absent when the turn is only a rendered block. */
  text?: string;
  /**
   * A Codex component command carried by an assistant turn. Kept as the raw
   * command so this module never imports the Tambo renderer — the host injects
   * a `renderBlock` that resolves it against the registry.
   */
  block?: CodexComponentCommand;
}

export type { CodexComponentCommand };
