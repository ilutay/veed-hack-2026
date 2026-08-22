/* Riso lesson player — implements docs/riso-system.md §7.
 *
 * Consumes the artifacts codex/tools/fal_media_agent.py actually writes:
 *   <run>/asset-manifest.json                          (run root, not a stage dir)
 *   <run>/lesson-script.json                           (named by manifest.lesson_script)
 *   <run>/02-content-generation/narration-timings.json  { estimated, segments }
 *
 * Two entry points, one renderer: mount({root, base}) fetches, or mount({root, data})
 * uses data the assembled index.html inlined.
 */

// `base` may be a relative run path ("../codex/examples/fixture-run/"), which is not a
// valid URL base on its own — resolve it against the document first.
const abs = (base) => new URL(base, document.baseURI).href;
const j = (base, p) => new URL(p, abs(base)).href;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** HEAD-probe an asset. A manifest may declare a file the stage never produced
 *  (fal_media_agent always writes talking_head_intro, provider "pending"). */
async function exists(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function load(base) {
  const manifest = await fetchJSON(j(base, "asset-manifest.json"));
  const script = await fetchJSON(j(base, manifest.lesson_script || "lesson-script.json"));
  let timings = null;
  try {
    timings = await fetchJSON(j(base, "02-content-generation/narration-timings.json"));
  } catch {
    /* optional — fall back to manifest.timings, then to slide durations */
  }
  return { manifest, script, timings, base };
}

/* ── timing model (§7) ──────────────────────────────────────────────────── */

/** Boundaries in seconds, one per slide, scaled to the real audio when the
 *  timings are estimated or disagree with it. */
export function buildBoundaries({ script, manifest, timings }, audioDuration) {
  const segs =
    timings?.segments ||
    manifest.timings ||
    script.slides.map((s, i, a) => {
      const start = a.slice(0, i).reduce((t, x) => t + x.duration_seconds, 0);
      return { slide_id: s.id, start_seconds: start, end_seconds: start + s.duration_seconds };
    });

  const byId = new Map(segs.map((s) => [s.slide_id, s]));
  let bounds = script.slides.map((s, i) => {
    const seg = byId.get(s.id);
    if (seg) return { start: seg.start_seconds, end: seg.end_seconds };
    const start = script.slides.slice(0, i).reduce((t, x) => t + x.duration_seconds, 0);
    return { start, end: start + s.duration_seconds };
  });

  const span = bounds[bounds.length - 1].end;
  const estimated = timings?.estimated === true;
  let scaled = false;
  // Rule 2: an over-long track stretches proportionally instead of truncating
  // the final slide. Guard against a zero/NaN duration on a not-yet-loaded track.
  if (audioDuration && isFinite(audioDuration) && span > 0) {
    if (estimated || Math.abs(audioDuration - span) > 0.5) {
      const k = audioDuration / span;
      bounds = bounds.map((b) => ({ start: b.start * k, end: b.end * k }));
      scaled = true;
    }
  }
  return { bounds, scaled, span };
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* ── render ─────────────────────────────────────────────────────────────── */

export async function mount(el, bundle, opts = {}) {
  const { script, manifest, base } = bundle;
  const slides = script.slides;
  const url = (p) => j(base, p);

  const voice = manifest.assets?.voiceover;
  const intro = manifest.assets?.talking_head_intro;
  const imgs = new Map((manifest.assets?.slide_images || []).map((a) => [a.slide_id, a]));

  // A declared asset whose file is absent is a normal state, not an error.
  const introUsable =
    !!intro && intro.provider !== "pending" && !!script.intro && (await exists(url(intro.path)));
  const voiceUsable = !!voice && (await exists(url(voice.path)));
  const isPlaceholder = (a) => a && /placeholder|pending|dry-run/i.test(a.provider || "");

  el.innerHTML = `
    <div class="wrap">
      <header>
        <h1 class="display misreg">${esc(script.title)}</h1>
        <p class="objective">${esc(script.learning_objective)}</p>
      </header>

      ${
        introUsable
          ? `<section class="intro-sec">
               <h2 class="display misreg">Intro</h2>
               <div class="stage">
                 ${isPlaceholder(intro) ? `<span class="placeholder-tag">placeholder</span>` : ""}
                 <video src="${esc(url(intro.path))}" controls playsinline preload="metadata"></video>
               </div>
             </section>`
          : script.intro
          ? `<section class="intro-sec">
               <h2 class="display misreg">Intro</h2>
               <div class="stage"><div class="missing">
                 <strong class="display">Intro not rendered</strong>
                 <span>The script asks for a presenter intro but the talking-head stage has not run
                 (<code>provider: ${esc(intro?.provider || "absent")}</code>).</span>
               </div></div>
             </section>`
          : ""
      }

      <section class="slides-sec">
        <div class="stage" id="stage"></div>
        <div class="controls">
          <button class="btn" id="prev" aria-label="Previous slide">&larr; Prev</button>
          <button class="btn btn-primary" id="play">${voiceUsable ? "Play" : "No audio"}</button>
          <button class="btn" id="next" aria-label="Next slide">Next &rarr;</button>
          <span class="counter" id="counter"></span>
          <div class="track" id="track"><div class="fill" id="fill"></div><div class="ticks" id="ticks"></div></div>
        </div>
        <p class="timing-note" id="timingNote"></p>
        ${
          voiceUsable
            ? (voice.media_type || "").startsWith("video/")
              ? `<video id="audio" src="${esc(url(voice.path))}" style="display:none" preload="metadata"></video>`
              : `<audio id="audio" src="${esc(url(voice.path))}" preload="metadata"></audio>`
            : ""
        }
      </section>

      <section class="next-sec">
        <h2 class="display misreg">What next?</h2>
        <div class="choices" id="choices"></div>
      </section>

      ${
        script.sources?.length
          ? `<section class="sources">
               <h2 class="display">Sources</h2>
               <ol>${script.sources
                 .map(
                   (s) =>
                     `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${
                       s.publisher ? ` — ${esc(s.publisher)}` : ""
                     }${s.accessed_at ? ` <span class="dim">(${esc(s.accessed_at)})</span>` : ""}</li>`
                 )
                 .join("")}</ol>
             </section>`
          : `<section class="sources"><h2 class="display">Sources</h2><p class="dim">No sources supplied with this script.</p></section>`
      }
    </div>`;

  const $ = (id) => el.querySelector("#" + id);
  const stage = $("stage"), counter = $("counter"), fill = $("fill"), ticks = $("ticks");
  const audio = $("audio");
  let i = -1, bounds = null, scaled = false;

  function paintSlide(n) {
    if (n === i) return;
    i = n;
    const s = slides[n];
    const a = imgs.get(s.id);
    const src = a ? url(a.path) : null;
    stage.innerHTML = `
      ${isPlaceholder(a) ? `<span class="placeholder-tag">placeholder</span>` : ""}
      ${
        src
          ? `<img class="snap" src="${esc(src)}" alt="${esc(s.title)}"
                onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'missing',innerHTML:'<strong class=&quot;display&quot;>Image missing</strong>'}))">`
          : `<div class="missing"><strong class="display">No image for ${esc(s.id)}</strong></div>`
      }
      <div class="caption snap">
        <p class="slide-title">${esc(s.title)}</p>
        <p class="narration">${esc(s.narration)}</p>
      </div>`;
    counter.textContent = `${n + 1} / ${slides.length}`;
    if (bounds) fill.style.right = `${100 - (bounds[n].start / bounds[slides.length - 1].end) * 100}%`;
    opts.onSlide?.(n, s);
  }

  function seekTo(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (audio && bounds) audio.currentTime = bounds[n].start + 0.01;
    paintSlide(n);
  }

  $("prev").onclick = () => seekTo(i - 1);   // Rule 3: always live
  $("next").onclick = () => seekTo(i + 1);
  $("play").onclick = () => {
    if (!audio) return seekTo(i + 1);
    if (audio.paused) { audio.play(); $("play").textContent = "Pause"; }
    else { audio.pause(); $("play").textContent = "Play"; }
  };

  function applyBounds(dur) {
    const r = buildBoundaries(bundle, dur);
    bounds = r.bounds; scaled = r.scaled;
    const total = bounds[bounds.length - 1].end;
    ticks.innerHTML = bounds
      .slice(1)
      .map((b) => `<span class="tick" style="left:${(b.start / total) * 100}%"></span>`)
      .join("");
    $("timingNote").textContent = scaled
      ? `Slide timings were estimated (${r.span.toFixed(1)}s) and have been scaled to the actual audio (${dur.toFixed(1)}s).`
      : "";
  }

  // Paint immediately from the script — the page must be useful before (or without)
  // audio metadata. Only the *timing* waits on the track (§7 rule 3).
  applyBounds(audio ? NaN : NaN);
  paintSlide(0);

  if (audio) {
    audio.addEventListener("loadedmetadata", () => {
      applyBounds(audio.duration);
      // re-seat the progress fill against the newly scaled bounds
      fill.style.right = `${100 - (audio.currentTime / bounds[slides.length - 1].end) * 100}%`;
    });
    audio.addEventListener("error", () => {
      $("timingNote").textContent =
        "Voiceover failed to load — use Prev / Next to move through the slides.";
      $("play").textContent = "No audio";
    });
    // Rule 1: drive from currentTime, never a timer chain.
    audio.addEventListener("timeupdate", () => {
      if (!bounds) return;
      const t = audio.currentTime;
      const n = bounds.findIndex((b) => t >= b.start && t < b.end);
      if (n >= 0) paintSlide(n);
      fill.style.right = `${100 - (t / bounds[bounds.length - 1].end) * 100}%`;
    });
    audio.addEventListener("ended", () => { $("play").textContent = "Replay"; opts.onEnded?.(); });
    if (audio.readyState >= 1) applyBounds(audio.duration);
  } else {
    $("timingNote").textContent =
      "No voiceover available — use Prev / Next to move through the slides.";
  }

  const dirOf = (label) => ({ A: "deeper", B: "wider", C: "applied" }[label] || "wider");
  $("choices").innerHTML = (script.next_video || [])
    .map(
      (n) => `<button class="choice snap" data-direction="${dirOf(n.label)}" data-label="${esc(n.label)}">
                <span class="band"><span class="label">${esc(n.label)}</span></span>
                <span class="direction">${esc(n.direction)}</span>
              </button>`
    )
    .join("");
  $("choices").querySelectorAll(".choice").forEach((b) =>
    b.addEventListener("click", () =>
      opts.onChoose?.({ label: b.dataset.label, direction: b.querySelector(".direction").textContent })
    )
  );

  return { seekTo, get index() { return i; }, get scaled() { return scaled; } };
}

export async function mountFrom(el, base, opts) {
  return mount(el, await load(base), opts);
}
