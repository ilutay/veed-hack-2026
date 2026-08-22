import type {
  FixtureLessonScript,
  FixtureManifest,
  TimingSegment,
} from "./contracts";

export type TimingBundle = {
  script: Pick<FixtureLessonScript, "slides">;
  manifest: Pick<FixtureManifest, "timings">;
  timings?: { estimated?: boolean; segments?: TimingSegment[] } | null;
};

export type Boundary = { start: number; end: number };

export function buildBoundaries(
  { script, manifest, timings }: TimingBundle,
  audioDuration: number,
): { bounds: Boundary[]; scaled: boolean; span: number } {
  const segments =
    timings?.segments ??
    manifest.timings ??
    script.slides.map((slide, index, slides) => {
      const start = slides
        .slice(0, index)
        .reduce((total, item) => total + item.duration_seconds, 0);
      return {
        slide_id: slide.id,
        start_seconds: start,
        end_seconds: start + slide.duration_seconds,
      };
    });
  const byId = new Map(segments.map((segment) => [segment.slide_id, segment]));
  let bounds = script.slides.map((slide, index, slides) => {
    const segment = byId.get(slide.id);
    if (segment) {
      return { start: segment.start_seconds, end: segment.end_seconds };
    }
    const start = slides
      .slice(0, index)
      .reduce((total, item) => total + item.duration_seconds, 0);
    return { start, end: start + slide.duration_seconds };
  });
  const span = bounds.at(-1)?.end ?? 0;
  let scaled = false;
  if (Number.isFinite(audioDuration) && audioDuration > 0 && span > 0) {
    if (timings?.estimated === true || Math.abs(audioDuration - span) > 0.5) {
      const ratio = audioDuration / span;
      bounds = bounds.map((boundary) => ({
        start: boundary.start * ratio,
        end: boundary.end * ratio,
      }));
      scaled = true;
    }
  }
  return { bounds, scaled, span };
}
