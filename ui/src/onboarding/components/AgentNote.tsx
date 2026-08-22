import type { AgentNoteProps } from "../schemas";

/** A plain reply from the tutor when no interactive surface is needed. */
export function AgentNote({ text }: AgentNoteProps) {
  return (
    <p className="objective" data-testid="agent-note" style={{ margin: 0 }}>
      {text}
    </p>
  );
}
