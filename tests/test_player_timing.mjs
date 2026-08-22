/* Timing-model tests for page/player.js §7.
 * Pure functions only — no DOM, no media element, so this is deterministic
 * where a browser's media stack is not.
 *
 *   node tests/test_player_timing.mjs
 */
import { readFileSync } from "node:fs";
import { buildBoundaries } from "../page/player.js";

let failures = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); failures++; }
}

const R = "codex/examples/fixture-run";
const read = (p) => JSON.parse(readFileSync(`${R}/${p}`, "utf8"));
const bundle = {
  script: read("lesson-script.json"),
  manifest: read("asset-manifest.json"),
  timings: read("02-content-generation/narration-timings.json"),
};
const n = bundle.script.slides.length;

console.log("fixture: estimated timings, script span 15s");
{
  const { bounds, scaled, span } = buildBoundaries(bundle, 15.0);
  check("span is the script's 15s", near(span, 15));
  check("scales even at parity (estimated:true)", scaled === true);
  check("last boundary ends at the audio duration", near(bounds[n - 1].end, 15));
  check("first boundary starts at 0", near(bounds[0].start, 0));
}

console.log("drift: the same script against a 19s track");
{
  const { bounds, scaled } = buildBoundaries(bundle, 19.0);
  check("marked scaled", scaled === true);
  check("last slide ends WITH the audio, not before", near(bounds[n - 1].end, 19),
        `got ${bounds[n - 1].end}`);
  check("every slide still has positive duration",
        bounds.every((b) => b.end > b.start));
  check("boundaries stay contiguous",
        bounds.every((b, i) => i === 0 || near(b.start, bounds[i - 1].end)));
  check("proportions preserved (slide 1 is 2/15 of the track)",
        near(bounds[0].end / 19, 2 / 15));
}

console.log("drift: a track shorter than the script (11s)");
{
  const { bounds } = buildBoundaries(bundle, 11.0);
  check("last slide ends with the audio", near(bounds[n - 1].end, 11));
  check("no slide is skipped", bounds.length === n);
}

console.log("no audio at all");
{
  const { bounds, scaled } = buildBoundaries(bundle, NaN);
  check("not scaled", scaled === false);
  check("falls back to the script's own durations", near(bounds[n - 1].end, 15));
  check("all slides present", bounds.length === n);
}

console.log("timings absent entirely — falls back to manifest.timings");
{
  const { bounds } = buildBoundaries({ ...bundle, timings: null }, NaN);
  check("still produces one boundary per slide", bounds.length === n);
  check("ends at 15s", near(bounds[n - 1].end, 15));
}

console.log("neither timings nor manifest.timings — falls back to slide durations");
{
  const m = structuredClone(bundle.manifest); delete m.timings;
  const { bounds } = buildBoundaries({ ...bundle, timings: null, manifest: m }, NaN);
  check("derives boundaries from duration_seconds", near(bounds[n - 1].end, 15));
  check("contiguous", bounds.every((b, i) => i === 0 || near(b.start, bounds[i - 1].end)));
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
