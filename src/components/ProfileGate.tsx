import { useCodexAction } from "@/components/CodexActionProvider";
import { WidthFollowTitle } from "@/components/WidthFollowTitle";
import { PROFILE_STORAGE_KEY, slugFromName } from "@/lib/onboarding";
import { createProfile } from "@/lib/profiles";
import type { ProfileGateProps } from "@/lib/schemas";
import { useState } from "react";

export function ProfileGate(_props: ProfileGateProps) {
  const { dispatch, pending, setProfile } = useCodexAction();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const slug = slugFromName(name);

  return (
    <form
      className="composer snap"
      onSubmit={(e) => {
        e.preventDefault();
        const value = name.trim();
        if (!value || !slug || pending) return;
        setError(null);
        void (async () => {
          try {
            const { created, profile } = await createProfile(value);
            window.localStorage.setItem(PROFILE_STORAGE_KEY, profile.slug);
            setProfile(profile);
            await dispatch({
              type: "profile_entered",
              payload: {
                name: profile.name,
                slug: profile.slug,
                created,
              },
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not enter");
          }
        })();
      }}
    >
      <WidthFollowTitle>What should we call you?</WidthFollowTitle>
      <p className="objective">
        Type your name. If you have been here before, we will open that
        profile. If not, we will start a short survey.
      </p>
      <div className="composer-row">
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ada"
          autoComplete="name"
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={pending || !slug}
        >
          {pending ? "Entering…" : "Continue"}
        </button>
      </div>
      {error ? <p className="receipt">{error}</p> : null}
    </form>
  );
}
