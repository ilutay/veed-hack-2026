import { useCodexAction } from "@/components/CodexActionProvider";
import type { LessonPlayerProps } from "@/lib/schemas";
import { buildBoundaries, type TimingBundle } from "@/lib/timing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Slide = {
  id: string;
  title: string;
  narration: string;
  duration_seconds: number;
};

type Asset = {
  path: string;
  media_type?: string;
  provider?: string;
  slide_id?: string;
};

type LessonScript = {
  title: string;
  learning_objective: string;
  intro?: unknown;
  slides: Slide[];
  sources?: Array<{
    title: string;
    url: string;
    publisher?: string;
    accessed_at?: string;
  }>;
};

type Manifest = {
  lesson_script?: string;
  timings?: TimingBundle["manifest"]["timings"];
  assets?: {
    voiceover?: Asset;
    talking_head_intro?: Asset;
    slide_images?: Asset[];
  };
};

type RunPayload = {
  status: string;
  stage?: string;
  error?: string;
  run_id: string;
  script: LessonScript | null;
  manifest: Manifest | null;
  timings: TimingBundle["timings"];
};

function isPlaceholder(a?: Asset | null) {
  return !!a && /placeholder|pending|dry-run/i.test(a.provider || "");
}

export function LessonPlayer({ run_id, runBase }: LessonPlayerProps) {
  const { dispatch, setPlaying: setPlayingGlobal } = useCodexAction();
  const [payload, setPayload] = useState<RunPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [voiceUsable, setVoiceUsable] = useState(false);
  const [introUsable, setIntroUsable] = useState(false);
  const [imgBroken, setImgBroken] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [boundsState, setBoundsState] = useState<ReturnType<
    typeof buildBoundaries
  > | null>(null);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const endedRef = useRef(false);

  const markPlaying = useCallback(
    (next: boolean) => {
      setPlaying(next);
      setPlayingGlobal(next);
    },
    [setPlayingGlobal],
  );

  useEffect(() => {
    return () => setPlayingGlobal(false);
  }, [setPlayingGlobal]);

  const assetBase = run_id
    ? `/api/run/${encodeURIComponent(run_id)}/file/`
    : runBase || "";
  const fileUrl = useCallback(
    (p: string) => {
      if (run_id)
        return `${assetBase}${p.split("/").map(encodeURIComponent).join("/")}`;
      return new URL(p, assetBase.endsWith("/") ? assetBase : assetBase + "/")
        .href;
    },
    [assetBase, run_id],
  );

  useEffect(() => {
    if (!run_id && !runBase) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        if (run_id) {
          const res = await fetch(`/api/run/${encodeURIComponent(run_id)}`);
          if (res.status === 404) {
            if (!cancelled) setError("Unknown run");
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as RunPayload;
          if (cancelled) return;
          if (body.status === "failed") {
            setError(body.error || "Pipeline failed");
            setPayload(body);
            return;
          }
          setPayload(body);
          if (body.status === "ready" && body.script && body.manifest) {
            setError(null);
            return;
          }
        } else if (runBase) {
          const manifest = (await (
            await fetch(new URL("asset-manifest.json", runBase))
          ).json()) as Manifest;
          const scriptPath = manifest.lesson_script || "lesson-script.json";
          const script = (await (
            await fetch(new URL(scriptPath, runBase))
          ).json()) as LessonScript;
          let timings: TimingBundle["timings"] = null;
          try {
            timings = await (
              await fetch(
                new URL(
                  "02-content-generation/narration-timings.json",
                  runBase,
                ),
              )
            ).json();
          } catch {
            timings = null;
          }
          if (cancelled) return;
          setPayload({
            status: "ready",
            run_id: "runBase",
            script,
            manifest,
            timings,
          });
          return;
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "poll failed");
      }
      timer = setTimeout(poll, 600);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [run_id, runBase]);

  const script = payload?.script ?? null;
  const manifest = payload?.manifest ?? null;
  const slides = script?.slides ?? [];
  const imgs = useMemo(
    () =>
      new Map(
        (manifest?.assets?.slide_images || []).map((a) => [a.slide_id, a]),
      ),
    [manifest],
  );
  const voice = manifest?.assets?.voiceover;
  const intro = manifest?.assets?.talking_head_intro;

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    const probe = async (p?: string) => {
      if (!p) return false;
      try {
        const r = await fetch(fileUrl(p), { method: "HEAD" });
        return r.ok;
      } catch {
        return false;
      }
    };
    void (async () => {
      const v = await probe(voice?.path);
      const i =
        !!intro &&
        intro.provider !== "pending" &&
        !!script?.intro &&
        (await probe(intro.path));
      if (!cancelled) {
        setVoiceUsable(v);
        setIntroUsable(i);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manifest, voice?.path, intro, script?.intro, fileUrl]);

  const bundle: TimingBundle | null = useMemo(() => {
    if (!script || !manifest) return null;
    return { script, manifest, timings: payload?.timings ?? null };
  }, [script, manifest, payload?.timings]);

  const applyBounds = useCallback(
    (dur: number) => {
      if (!bundle) return;
      setBoundsState(buildBoundaries(bundle, dur));
    },
    [bundle],
  );

  useEffect(() => {
    if (bundle) applyBounds(Number.NaN);
  }, [bundle, applyBounds]);

  const bounds = boundsState?.bounds ?? null;
  const slide = slides[index];
  const slideAsset = slide ? imgs.get(slide.id) : undefined;
  const slideSrc = slideAsset ? fileUrl(slideAsset.path) : null;
  const total = bounds?.[bounds.length - 1]?.end || 1;

  const emitEnded = useCallback(() => {
    if (endedRef.current || !run_id) return;
    endedRef.current = true;
    void dispatch({ type: "playback_ended", payload: { run_id } });
  }, [dispatch, run_id]);

  const paintIndex = useCallback(
    (n: number, seek = false) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, n));
      setIndex(clamped);
      const el = audioRef.current;
      if (seek && el && bounds) el.currentTime = bounds[clamped].start + 0.01;
      if (bounds) setProgress(bounds[clamped].start / total);
      if (clamped === slides.length - 1 && !voiceUsable) emitEnded();
    },
    [slides.length, bounds, total, voiceUsable, emitEnded],
  );

  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !bounds) return;
    const t = el.currentTime;
    const n = bounds.findIndex((b) => t >= b.start && t < b.end);
    if (n >= 0) setIndex(n);
    setProgress(t / (bounds[bounds.length - 1].end || 1));
  };

  if (!run_id && !runBase) {
    return (
      <div className="wrap">
        <div className="missing">
          <strong className="display">No run</strong>
          <span>LessonPlayer needs a run_id.</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="wrap">
        <div className="missing">
          <strong className="display">Could not load run</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!script || !manifest) {
    const stage = payload?.stage || "queued";
    const label =
      {
        queued: "Queued",
        research: "Researching the topic",
        script: "Writing the lesson script",
        media: "Generating slides and voiceover",
        ready: "Almost ready",
        failed: "Failed",
      }[stage] || stage;
    return (
      <div className="wrap">
        <p className="receipt">
          {label}
          {run_id ? ` · ${run_id}` : ""}
        </p>
        <div className="stage">
          <div className="missing">
            <strong className="display">{label}</strong>
            <span>
              Receipt is in. The player mounts when the research brief, script,
              and media manifest are on disk.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const voiceIsVideo = (voice?.media_type || "").startsWith("video/");
  const playLabel =
    audioFailed || !voiceUsable ? "No audio" : playing ? "Pause" : "Play";

  return (
    <div className="wrap">
      <header>
        <h1 className="display">{script.title}</h1>
        <p className="objective">{script.learning_objective}</p>
      </header>

      {introUsable && intro ? (
        <section className="intro-sec">
          <h2>Intro</h2>
          <div className="stage">
            {isPlaceholder(intro) ? (
              <span className="placeholder-tag">placeholder</span>
            ) : null}
            <video
              src={fileUrl(intro.path)}
              controls
              playsInline
              preload="metadata"
            />
          </div>
        </section>
      ) : script.intro ? (
        <section className="intro-sec">
          <h2>Intro</h2>
          <div className="stage">
            <div className="missing">
              <strong className="display">Intro not rendered</strong>
              <span>
                The script asks for a presenter intro but the talking-head stage
                has not run (
                <code>provider: {intro?.provider || "absent"}</code>).
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="slides-sec">
        <div className="stage">
          {isPlaceholder(slideAsset) ? (
            <span className="placeholder-tag">placeholder</span>
          ) : null}
          {slideSrc && !imgBroken[slide?.id || ""] ? (
            <img
              key={slide?.id}
              className="snap"
              src={slideSrc}
              alt={slide?.title || ""}
              onError={() => setImgBroken((m) => ({ ...m, [slide.id]: true }))}
            />
          ) : (
            <div className="missing">
              <strong className="display">
                {slide ? `No image for ${slide.id}` : "Image missing"}
              </strong>
            </div>
          )}
          {slide ? (
            <div className="caption snap" key={`cap-${slide.id}`}>
              <p className="slide-title">{slide.title}</p>
              <p className="narration">{slide.narration}</p>
            </div>
          ) : null}
        </div>
        <div className="controls">
          <button
            className="btn"
            type="button"
            aria-label="Previous slide"
            onClick={() => paintIndex(index - 1, true)}
          >
            ← Prev
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              const el = audioRef.current;
              if (!el || !voiceUsable || audioFailed) {
                paintIndex(index + 1, true);
                return;
              }
              if (el.paused) {
                void el.play();
                markPlaying(true);
              } else {
                el.pause();
                markPlaying(false);
              }
            }}
          >
            {playLabel}
          </button>
          <button
            className="btn"
            type="button"
            aria-label="Next slide"
            onClick={() => paintIndex(index + 1, true)}
          >
            Next →
          </button>
          <span className="counter">
            {slides.length ? `${index + 1} / ${slides.length}` : "0 / 0"}
          </span>
          <div className="track">
            <div
              className="fill"
              style={{ right: `${100 - progress * 100}%` }}
            />
            <div className="ticks">
              {(bounds || []).slice(1).map((b) => (
                <span
                  key={b.start}
                  className="tick"
                  style={{ left: `${(b.start / total) * 100}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="timing-note">
          {audioFailed
            ? "Voiceover failed to load — use Prev / Next to move through the slides."
            : !voiceUsable
              ? "No voiceover available — use Prev / Next to move through the slides."
              : boundsState?.scaled
                ? `Slide timings were estimated (${boundsState.span.toFixed(1)}s) and have been scaled to the actual audio.`
                : ""}
        </p>
        {voiceUsable && voice ? (
          voiceIsVideo ? (
            <video
              ref={(n) => {
                audioRef.current = n;
              }}
              src={fileUrl(voice.path)}
              style={{ display: "none" }}
              preload="metadata"
              onLoadedMetadata={(e) => applyBounds(e.currentTarget.duration)}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => {
                markPlaying(false);
                emitEnded();
              }}
              onError={() => setAudioFailed(true)}
            />
          ) : (
            <audio
              ref={(n) => {
                audioRef.current = n;
              }}
              src={fileUrl(voice.path)}
              preload="metadata"
              onLoadedMetadata={(e) => applyBounds(e.currentTarget.duration)}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => {
                markPlaying(false);
                emitEnded();
              }}
              onError={() => setAudioFailed(true)}
            />
          )
        ) : null}
      </section>

      {script.sources?.length ? (
        <section className="sources">
          <h2>Sources</h2>
          <ol>
            {script.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
                {s.publisher ? ` — ${s.publisher}` : ""}
                {s.accessed_at ? (
                  <span className="dim"> ({s.accessed_at})</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <section className="sources">
          <h2>Sources</h2>
          <p className="dim">No sources supplied with this script.</p>
        </section>
      )}
    </div>
  );
}
