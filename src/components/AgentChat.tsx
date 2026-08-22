import { useCodexAction } from "@/components/CodexActionProvider";
import type { ChatTurn } from "@/lib/onboarding";
import { getChat, postChat } from "@/lib/profiles";
import { useEffect, useRef, useState } from "react";

export function AgentChat() {
  const { profile, setProfile } = useCodexAction();
  const [open, setOpen] = useState(true);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const enabled = Boolean(profile?.slug);

  useEffect(() => {
    if (!profile?.slug) {
      setTurns([]);
      return;
    }
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
  }, [turns.length]);

  return (
    <aside className={`chat-dock${open ? " is-open" : " is-collapsed"}`}>
      <button
        type="button"
        className="chat-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="display">Agent</span>
        <span className="chat-toggle-hint">{open ? "Hide" : "Show"}</span>
      </button>
      <div className="chat-body">
        <h2 className="display misreg chat-heading">Agent</h2>
        <div className="chat-log" ref={logRef}>
          {turns.length === 0 ? (
            <p className="dim">
              {enabled
                ? "Tell the agent how you like to learn. Pace, depth, examples — it writes it down."
                : "Enter your name first. Then you can talk to the agent from here."}
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
        </div>
        {error ? <p className="receipt">{error}</p> : null}
        <form
          className="chat-compose"
          onSubmit={(e) => {
            e.preventDefault();
            const value = message.trim();
            if (!value || !profile?.slug || sending) return;
            setSending(true);
            setError(null);
            void (async () => {
              try {
                const body = await postChat(profile.slug, value);
                setTurns(body.turns);
                setProfile(body.profile);
                setMessage("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "send failed");
              } finally {
                setSending(false);
              }
            })();
          }}
        >
          <input
            type="text"
            name="chat"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              enabled ? "e.g. slower, more examples" : "Enter a name first"
            }
            autoComplete="off"
            disabled={!enabled || sending}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!enabled || sending || !message.trim()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
