import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CodexComponentCommand, ThreadMessage } from "./types";

/**
 * The full chat surface: where a user asks Codex to build a lesson.
 *
 * Tambo ships a component of the same name, but it is wired to Tambo threads
 * through useTamboThreadInput/useTambo. We use Tambo as a registry and renderer
 * only — there is no TamboProvider, API key, or thread — so that version cannot
 * run here. This is our equivalent, backed by the Codex bridge: the host owns
 * the transcript and turns `onSubmit` into a bridge call.
 *
 * It is deliberately NOT registered in the Tambo registry. It is our chrome;
 * Codex renders into it via the injected `renderBlock`, which is also why this
 * file never imports ComponentRenderer.
 */
export interface MessageThreadFullProps {
  messages: ThreadMessage[];
  /** The user submitted the prompt input. */
  onSubmit: (text: string) => void;
  /** A Codex turn is in flight. */
  busy?: boolean;
  /** Injected renderer for a message's Codex block. */
  renderBlock: (block: CodexComponentCommand) => ReactNode;
}

export function MessageThreadFull({
  messages,
  onSubmit,
  busy = false,
  renderBlock,
}: MessageThreadFullProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const transcript = useRef<HTMLDivElement>(null);

  // Follow the tail as turns arrive; a chat that strands the user mid-scroll
  // reads as if nothing happened.
  useEffect(() => {
    const node = transcript.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSubmit(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter is the only way to get a newline into a single-control
    // composer, so Enter alone has to be the submit.
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  return (
    <section
      data-testid="message-thread-full"
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", minHeight: 0 }}
    >
      <div
        ref={transcript}
        role="log"
        aria-label="Lesson conversation"
        data-testid="thread-transcript"
        style={{ overflowY: "auto", flex: 1, minHeight: 0, display: "grid", gap: "0.75rem" }}
      >
        {messages.length === 0 && (
          <p data-testid="thread-empty" style={{ opacity: 0.7 }}>
            Ask Codex for a lesson — name a topic and who it is for, and it will
            build the slides, the voiceover and the video.
          </p>
        )}

        {messages.map((message) => (
          <article
            key={message.id}
            data-testid="thread-message"
            data-role={message.role}
            style={{ display: "grid", gap: "0.5rem" }}
          >
            <span style={{ fontSize: "0.75rem", textTransform: "uppercase", opacity: 0.6 }}>
              {message.role}
            </span>
            {message.text && <p style={{ margin: 0 }}>{message.text}</p>}
            {message.block && renderBlock(message.block)}
          </article>
        ))}

        {busy && (
          <p data-testid="thread-busy" role="status">
            Codex is building the lesson…
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        style={{ display: "grid", gap: "0.25rem" }}
      >
        <label htmlFor={inputId}>Ask Codex for a lesson</label>
        <textarea
          id={inputId}
          data-testid="thread-input"
          value={draft}
          rows={3}
          disabled={busy}
          placeholder="Teach attention routing to a first-year ML engineer"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          data-testid="thread-submit"
          disabled={busy || draft.trim().length === 0}
        >
          {busy ? "Working…" : "Send"}
        </button>
      </form>
    </section>
  );
}
