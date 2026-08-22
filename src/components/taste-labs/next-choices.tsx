"use client";

import { useEffect, useState } from "react";

import type {
  ChoiceLabel,
  FixtureRunPayload,
  NextChoicesProps,
} from "@/lib/taste-labs/contracts";

import { useTasteLabsDemo } from "./taste-labs-demo-provider";

const DIRECTIONS: Record<ChoiceLabel, string> = {
  A: "deeper",
  B: "wider",
  C: "applied",
};

export function NextChoices({ run_id }: NextChoicesProps) {
  const { dispatch } = useTasteLabsDemo();
  const [payload, setPayload] = useState<FixtureRunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/taste-labs/run/${run_id}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
        return (await response.json()) as FixtureRunPayload;
      })
      .then(setPayload)
      .catch((rawError: unknown) => {
        if (!controller.signal.aborted) {
          setError(rawError instanceof Error ? rawError.message : "Fixture unavailable");
        }
      });
    return () => controller.abort();
  }, [run_id]);

  if (error) return <p className="tasteReceipt" role="alert">{error}</p>;
  if (!payload) return <p className="tasteReceipt">Loading fixture choices…</p>;

  return (
    <section className="tasteSnap">
      <p className="tasteEyebrow">FIXTURE BRANCHES / NO RUN WILL START</p>
      <h1 className="tasteDisplay tasteMisreg">What next?</h1>
      <div className="tasteChoices">
        {(payload.script.next_video ?? []).map((choice) => (
          <button
            className="tasteChoice tasteSnap"
            data-direction={DIRECTIONS[choice.label]}
            key={choice.label}
            onClick={() =>
              dispatch({
                type: "choice_selected",
                payload: {
                  run_id,
                  label: choice.label,
                  direction: choice.direction,
                },
              })
            }
            type="button"
          >
            <span>{choice.label}</span>
            <small>{DIRECTIONS[choice.label]}</small>
            <strong>{choice.direction}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
