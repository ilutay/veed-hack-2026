"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  FixtureAsset,
  FixtureRunPayload,
  LessonPlayerProps,
} from "@/lib/taste-labs/contracts";
import { buildBoundaries } from "@/lib/taste-labs/timing";

import { useTasteLabsDemo } from "./taste-labs-demo-provider";

function fixtureFileUrl(relativePath: string): string {
  const safePath = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/taste-labs/run/fixture-dotcom/file/${safePath}`;
}

function isPlaceholder(asset?: FixtureAsset | null): boolean {
  return Boolean(asset && /placeholder|pending|dry-run/i.test(asset.provider ?? ""));
}

export function LessonPlayer({ run_id }: LessonPlayerProps) {
  const { dispatch } = useTasteLabsDemo();
  const [payload, setPayload] = useState<FixtureRunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voiceUsable, setVoiceUsable] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [imageFailures, setImageFailures] = useState<Record<string, boolean>>(
    {},
  );
  const [audioDuration, setAudioDuration] = useState(Number.NaN);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
        if (controller.signal.aborted) return;
        setError(rawError instanceof Error ? rawError.message : "Fixture unavailable");
      });
    return () => controller.abort();
  }, [run_id]);

  const voice = payload?.manifest.assets?.voiceover;
  useEffect(() => {
    if (!voice?.path) return;
    const controller = new AbortController();
    void fetch(fixtureFileUrl(voice.path), {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => setVoiceUsable(response.ok))
      .catch(() => {
        if (!controller.signal.aborted) setVoiceUsable(false);
      });
    return () => controller.abort();
  }, [voice?.path]);

  const slides = payload?.script.slides ?? [];
  const imageBySlide = useMemo(
    () =>
      new Map(
        (payload?.manifest.assets?.slide_images ?? []).map((asset) => [
          asset.slide_id,
          asset,
        ]),
      ),
    [payload],
  );
  const boundaries = useMemo(() => {
    if (!payload) return null;
    return buildBoundaries(
      {
        script: payload.script,
        manifest: payload.manifest,
        timings: payload.timings,
      },
      audioDuration,
    );
  }, [audioDuration, payload]);
  const currentSlide = slides[index];
  const currentImage = currentSlide
    ? imageBySlide.get(currentSlide.id)
    : undefined;
  const total = boundaries?.bounds.at(-1)?.end ?? 1;

  const finish = useCallback(() => {
    dispatch({ type: "playback_ended", payload: { run_id } });
  }, [dispatch, run_id]);

  const selectSlide = useCallback(
    (nextIndex: number, seek = false) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, nextIndex));
      setIndex(clamped);
      const audio = audioRef.current;
      const boundary = boundaries?.bounds[clamped];
      if (seek && audio && boundary) audio.currentTime = boundary.start + 0.01;
      if (boundary) setProgress(boundary.start / total);
    },
    [boundaries, slides.length, total],
  );

  if (error) {
    return (
      <div className="tasteMissing" role="alert">
        <strong className="tasteDisplay">Could not load fixture</strong>
        <span>{error}</span>
      </div>
    );
  }

  if (!payload || !currentSlide) {
    return (
      <div className="tasteMissing" aria-busy="true">
        <strong className="tasteDisplay">Opening tracked fixture</strong>
        <span>Authenticated, read-only files only.</span>
      </div>
    );
  }

  const imageUrl = currentImage ? fixtureFileUrl(currentImage.path) : null;
  const playLabel =
    audioFailed || !voiceUsable ? "No audio" : playing ? "Pause" : "Play";

  return (
    <article className="tasteLesson tasteSnap">
      <header>
        <p className="tasteEyebrow">TRACKED FIXTURE / {run_id}</p>
        <h1 className="tasteDisplay tasteMisreg">{payload.script.title}</h1>
        <p className="tasteObjective">{payload.script.learning_objective}</p>
      </header>

      <section className="tasteStage" aria-label="Lesson slide">
        {isPlaceholder(currentImage) ? (
          <span className="tastePlaceholder">fixture placeholder</span>
        ) : null}
        {imageUrl && !imageFailures[currentSlide.id] ? (
          // The image is an authenticated same-origin fixture response whose
          // dimensions are intentionally determined by the 16:9 player.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={currentSlide.title}
            className="tasteSnap"
            key={currentSlide.id}
            onError={() =>
              setImageFailures((current) => ({
                ...current,
                [currentSlide.id]: true,
              }))
            }
            src={imageUrl}
          />
        ) : (
          <div className="tasteMissing">
            <strong className="tasteDisplay">Image unavailable</strong>
          </div>
        )}
        <div className="tasteCaption tasteSnap" key={`caption-${currentSlide.id}`}>
          <p className="tasteSlideTitle">{currentSlide.title}</p>
          <p>{currentSlide.narration}</p>
        </div>
      </section>

      <div className="tasteControls">
        <button
          aria-label="Previous slide"
          className="tasteButton"
          disabled={index === 0}
          onClick={() => selectSlide(index - 1, true)}
          type="button"
        >
          ← Prev
        </button>
        <button
          className="tasteButton tasteButtonPrimary"
          disabled={!voiceUsable || audioFailed}
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (audio.paused) {
              void audio.play();
              setPlaying(true);
            } else {
              audio.pause();
              setPlaying(false);
            }
          }}
          type="button"
        >
          {playLabel}
        </button>
        <button
          aria-label="Next slide"
          className="tasteButton"
          disabled={index === slides.length - 1}
          onClick={() => selectSlide(index + 1, true)}
          type="button"
        >
          Next →
        </button>
        <span className="tasteCounter">
          {index + 1} / {slides.length}
        </span>
        <div className="tasteTrack" aria-hidden="true">
          <span style={{ right: `${100 - progress * 100}%` }} />
        </div>
      </div>

      <p className="tasteDim">
        All media is served from the tracked fixture through authenticated,
        no-store endpoints. Placeholder media is labelled honestly.
      </p>
      <button
        className="tasteButton tasteContinue"
        onClick={finish}
        type="button"
      >
        Continue to fixture choices →
      </button>

      {voiceUsable && voice ? (
        <audio
          onEnded={() => {
            setPlaying(false);
            finish();
          }}
          onError={() => setAudioFailed(true)}
          onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime;
            const nextIndex = boundaries?.bounds.findIndex(
              (boundary) => time >= boundary.start && time < boundary.end,
            );
            if (typeof nextIndex === "number" && nextIndex >= 0) setIndex(nextIndex);
            setProgress(time / total);
          }}
          preload="metadata"
          ref={audioRef}
          src={fixtureFileUrl(voice.path)}
        />
      ) : null}

      <section className="tasteSources">
        <h2 className="tasteDisplay">Sources</h2>
        {payload.script.sources?.length ? (
          <ol>
            {payload.script.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} rel="noopener noreferrer" target="_blank">
                  {source.title}
                </a>
                {source.publisher ? ` — ${source.publisher}` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p className="tasteDim">No sources supplied with this fixture.</p>
        )}
      </section>
    </article>
  );
}
