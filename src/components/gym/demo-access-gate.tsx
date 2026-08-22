"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import styles from "./gym.module.css";
import { GymExperience } from "./gym-experience";

type AccessState = "checking" | "locked" | "ready";

export function DemoAccessGate({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<AccessState>("checking");
  const [accessCode, setAccessCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/auth/access", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => setState(response.ok ? "ready" : "locked"))
      .catch(() => setState("locked"));

    return () => controller.abort();
  }, []);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    const value = accessCode.trim();
    if (!value || pending) return;

    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: value }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "The demo access code was not accepted.";
        setMessage(detail);
        return;
      }

      setAccessCode("");
      setState("ready");
    } catch {
      setMessage("The access service is unavailable. Nothing was submitted.");
    } finally {
      setPending(false);
    }
  };

  if (state === "ready") return children ?? <GymExperience />;

  return (
    <main className={`${styles.gymRoot} ${styles.accessRoot}`}>
      <section className={styles.accessCard} aria-busy={state === "checking" || pending}>
        <div className={styles.accessTopline}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>PG</span>
            <span>
              Pioneer Gym
              <small>Practice that adapts to you</small>
            </span>
          </div>
          <Link className={styles.lessonLink} href="/lesson">Watch a real lesson</Link>
        </div>
        <p className={styles.eyebrow}>PRIVATE HACKATHON DEMO</p>
        <h1>{state === "checking" ? "Checking access…" : "Ready to practice?"}</h1>
        <p className={styles.accessIntro}>
          Enter the shared code to begin a short learning session that adapts after every decision.
        </p>
        {state === "locked" ? (
          <form className={styles.accessForm} onSubmit={unlock}>
            <label htmlFor="demo-access-code">Shared access code</label>
            <div>
              <input
                autoComplete="current-password"
                autoFocus
                disabled={pending}
                id="demo-access-code"
                onChange={(event) => setAccessCode(event.target.value)}
                type="password"
                value={accessCode}
              />
              <button className={styles.primaryButton} disabled={pending || !accessCode.trim()} type="submit">
                {pending ? "Checking…" : "Enter Pioneer Gym"}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.accessPulse} aria-label="Checking access" />
        )}
        {message ? <p className={styles.accessError} role="alert">{message}</p> : null}
        <small className={styles.accessPolicy}>15-minute signed session · no provider keys in the browser</small>
      </section>
    </main>
  );
}
