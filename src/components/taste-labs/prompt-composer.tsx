"use client";

import { useState, type FormEvent } from "react";

import type { PromptComposerProps } from "@/lib/taste-labs/contracts";

import { useTasteLabsDemo } from "./taste-labs-demo-provider";

export function PromptComposer({ seed_topic }: PromptComposerProps) {
  const { dispatch } = useTasteLabsDemo();
  const [topic, setTopic] = useState(seed_topic ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = topic.trim();
    if (!value) return;
    dispatch({ type: "topic_submitted", payload: { topic: value } });
  };

  return (
    <form className="tasteComposer tasteSnap" onSubmit={submit}>
      <p className="tasteEyebrow">TASTE LABS / FIXTURE GALLERY</p>
      <h1 className="tasteDisplay tasteMisreg">What do you want to learn?</h1>
      <p className="tasteObjective">
        Try the teammate-designed lesson player with one tracked artifact set.
        Your text never leaves this browser; this gallery always opens the
        dot-com fixture.
      </p>
      <div className="tasteComposerRow">
        <input
          aria-label="Learning topic"
          autoComplete="off"
          name="topic"
          onChange={(event) => setTopic(event.target.value)}
          placeholder="e.g. why bubbles burst"
          type="text"
          value={topic}
        />
        <button
          className="tasteButton tasteButtonPrimary"
          disabled={!topic.trim()}
          type="submit"
        >
          Open fixture
        </button>
      </div>
    </form>
  );
}
