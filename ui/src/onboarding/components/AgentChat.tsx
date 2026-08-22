import { useEffect, useRef, useState } from "react";
import { useProfile } from "../ProfileProvider";

const SUGGESTED_PROMPTS = [
  "Make the explanation more technical",
  "Keep it simpler and slower",
  "Give me real-world examples",
  "Start from the principles",
];

/**
 * Side chat. Not a registered component: it is part of the frame and always
 * reachable. Preferences nudge the taste profile; a small deterministic
 * allowlist can also enqueue a typed lesson or practice action for the page.
 * Learner text here never becomes a model-authored component command.
 */
export function AgentChat() {
  const { profile, chat, sendChat } = useProfile();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Array<{ role: "learner" | "agent"; text: string }>>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const turns = profile ? chat : local;

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, open, sending]);

  const send = async (raw: string) => {
    const value = raw.trim();
    if (!value || sending) return;
    setMessage("");
    setSending(true);
    setError(null);
    try {
      const reply = await sendChat(value);
      if (!profile) setLocal((prev) => [...prev, { role: "learner", text: value }, { role: "agent", text: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className={`chat-dock${open ? " is-open" : " is-collapsed"}`}
      data-testid="agent-chat"
      aria-labelledby="agent-chat-heading"
    >
      <button
        type="button"
        className="chat-toggle"
        data-testid="agent-chat-toggle"
        aria-expanded={open}
        aria-controls="agent-chat-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="display">Agent</span>
        <span className="chat-toggle-hint">{open ? "Hide" : "Show"}</span>
      </button>
      <div className="chat-body" id="agent-chat-panel">
        <h2 className="display misreg chat-heading" id="agent-chat-heading">Agent</h2>
        <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions text">
          {turns.length === 0 ? (
            <p className="dim">
              {profile
                ? "Say how you like to learn. Pace, depth, examples — it writes it down for the next lesson."
                : "Say how you like to learn. Enter a name to have it remembered."}
            </p>
          ) : (
            turns.map((turn, i) => (
              <div key={i} className="chat-msg snap" data-role={turn.role} data-testid="agent-chat-turn">
                <span className="chat-role">{turn.role}</span>
                <p>{turn.text}</p>
              </div>
            ))
          )}
          {sending ? <p className="dim">Thinking…</p> : null}
        </div>
        {error ? <p className="receipt" role="alert">{error}</p> : null}
        <div className="chat-chips">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="chat-chip" disabled={sending} onClick={() => void send(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="chat-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send(message);
          }}
        >
          <input
            type="text"
            name="chat"
            data-testid="agent-chat-input"
            aria-label="Learning preference"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Set a preference or start a lesson…"
            autoComplete="off"
            disabled={sending}
          />
          <button className="btn btn-primary" type="submit" data-testid="agent-chat-send" disabled={sending || !message.trim()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
