/**
 * Playback timing model — docs/riso-system.md §7.
 *
 * Pure function. The Node test (`tests/test_player_timing.mjs`) imports this
 * file directly; keep it free of DOM and of framework APIs.
 */

export type TimingSegment = {
  slide_id: string;
  start_seconds: number;
  end_seconds: number;
};

export type TimingBundle = {
  script: {
    slides: Array<{ id: string; duration_seconds: number }>;
  };
  manifest: {
    timings?: TimingSegment[];
  };
  timings?: { estimated?: boolean; segments?: TimingSegment[] } | null;
};

export type Boundary = { start: number; end: number };

/** Boundaries in seconds, one per slide, scaled to the real audio when the
 *  timings are estimated or disagree with it. */
export function buildBoundaries(
  { script, manifest, timings }: TimingBundle,
  audioDuration: number,
): { bounds: Boundary[]; scaled: boolean; span: number } {
  const segs =
    timings?.segments ||
    manifest.timings ||
    script.slides.map((s, i, a) => {
      const start = a.slice(0, i).reduce((t, x) => t + x.duration_seconds, 0);
      return {
        slide_id: s.id,
        start_seconds: start,
        end_seconds: start + s.duration_seconds,
      };
    });

  const byId = new Map(segs.map((s) => [s.slide_id, s]));
  let bounds: Boundary[] = script.slides.map((s, i) => {
    const seg = byId.get(s.id);
    if (seg) return { start: seg.start_seconds, end: seg.end_seconds };
    const start = script.slides
      .slice(0, i)
      .reduce((t, x) => t + x.duration_seconds, 0);
    return { start, end: start + s.duration_seconds };
  });

  const span = bounds[bounds.length - 1].end;
  const estimated = timings?.estimated === true;
  let scaled = false;
  // Rule 2: an over-long track stretches proportionally instead of truncating
  // the final slide. Guard against a zero/NaN duration on a not-yet-loaded track.
  if (audioDuration && Number.isFinite(audioDuration) && span > 0) {
    if (estimated || Math.abs(audioDuration - span) > 0.5) {
      const k = audioDuration / span;
      bounds = bounds.map((b) => ({ start: b.start * k, end: b.end * k }));
      scaled = true;
    }
  }
  return { bounds, scaled, span };
}
