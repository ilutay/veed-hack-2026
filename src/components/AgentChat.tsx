import { useCodexAction } from "@/components/CodexActionProvider";
import type { ChatTurn } from "@/lib/onboarding";
import { runIdFromBlocks } from "@/lib/codex";
import { getChat, postChat } from "@/lib/profiles";
import { useCallback, useEffect, useRef, useState } from "react";

const SUGGESTED_PROMPTS = [
  "Explain this slide in deeper detail",
  "Make the explanation more technical",
  "Give me a real-world application example",
  "Summarize key takeaway so far",
];

function nowIso(): string {
  return new Date().toISOString();
}

export function AgentChat() {
  const { profile, setProfile, dispatch, blocks } = useCodexAction();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const persisted = Boolean(profile?.slug);
  const runId = runIdFromBlocks(blocks);
  const busy = sending;

  useEffect(() => {
    if (!profile?.slug) return;
    let cancelled = false;
    void getChat(profile.slug).then((next) => {
      if (!cancelled) setTurns(next);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.slug]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, sending]);

  const send = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value || busy) return;
      setSending(true);
      setError(null);
      setMessage("");
      try {
        if (profile?.slug) {
          const body = await postChat(profile.slug, value);
          setTurns(body.turns);
          setProfile(body.profile);
        } else {
          setTurns((prev) => [
            ...prev,
            { role: "learner", text: value, at: nowIso() },
            {
              role: "agent",
              text: "Noted. I'll keep that in mind.",
              at: nowIso(),
            },
          ]);
        }
        await dispatch({
          type: "agent_message",
          payload: { run_id: runId, message: value },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "send failed");
      } finally {
        setSending(false);
      }
    },
    [busy, dispatch, profile?.slug, runId, setProfile],
  );

  return (
    <aside className={`chat-dock${open ? " is-open" : " is-collapsed"}`}>
      <button
        type="button"
        className="chat-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="eyebrow">Agent</span>
        <span className="chat-toggle-hint">{open ? "Hide" : "Show"}</span>
      </button>
      <div className="chat-body">
        <p className="eyebrow chat-heading">Agent</p>
        <div className="chat-log" ref={logRef}>
          {turns.length === 0 ? (
            <p className="dim">
              {persisted
                ? "Ask about the lesson, or how you like to learn. Pace, depth, examples — it writes it down."
                : "Ask about the lesson, or how you like to learn. Enter a name to save it."}
            </p>
          ) : (
            turns.map((turn, i) => (
              <div
                key={`${turn.at}-${i}`}
                className="chat-msg snap"
                data-role={turn.role}
              >
                <span className="chat-role">{turn.role}</span>
                <p>{turn.text}</p>
              </div>
            ))
          )}
          {sending ? (
            <p className="dim">Codex is responding…</p>
          ) : null}
        </div>
        {error ? <p className="receipt">{error}</p> : null}
        <div className="chat-chips">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="chat-chip"
              disabled={busy}
              onClick={() => void send(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send(message);
          }}
        >
          <input
            type="text"
            name="chat"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask a question or give feedback…"
            autoComplete="off"
            disabled={busy}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !message.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
