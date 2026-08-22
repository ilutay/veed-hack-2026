import { useState } from "react";
import { useCodexAction } from "../../codex/CodexActionProvider";
import { slugFromName } from "../logic";
import { useProfile } from "../ProfileProvider";
import type { ProfileGateProps } from "../schemas";
import { WidthFollowTitle } from "./WidthFollowTitle";

/** First surface: a name either reopens a profile or starts the survey. */
export function ProfileGate(_props: ProfileGateProps) {
  const { emit, episodeId, turnId } = useCodexAction();
  const { enter } = useProfile();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const slug = slugFromName(name);

  return (
    <form
      className="composer snap"
      data-testid="profile-gate"
      onSubmit={(event) => {
        event.preventDefault();
        if (!slug || done || busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const { created, profile } = await enter(name);
            setDone(true);
            emit({
              component: "ProfileGate",
              episodeId,
              turnId,
              action: "profile.entered",
              payload: { name: profile.name, slug: profile.slug, created },
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not enter");
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <WidthFollowTitle>What should we call you?</WidthFollowTitle>
      <p className="objective">
        Type your name. If you have been here before, we will open that profile.
        If not, we will start a short survey.
      </p>
      <div className="composer-row">
        <input
          type="text"
          name="name"
          data-testid="profile-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Ada"
          autoComplete="name"
          disabled={done || busy}
        />
        <button
          className="btn btn-primary"
          type="submit"
          data-testid="profile-submit"
          disabled={done || busy || !slug}
        >
          {done ? "Entered" : busy ? "Entering…" : "Continue"}
        </button>
      </div>
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
