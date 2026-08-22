import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Landing-title width follow.
 *
 * Tilt Neon (Google Fonts v12) is a variable font, but it has no `wdth` axis —
 * `css2?family=Tilt+Neon:wdth@75..125` returns 400 "Missing font family".
 * Live axes are XROT and YROT, both −45..45.
 *
 * We still drive `"wdth"` in `font-variation-settings` (ignored by the file)
 * and map the same 100→125 range onto `scaleX`, so glyphs actually widen
 * under the pointer. XROT/YROT tilt each glyph toward the cursor — the axis
 * the face was drawn for.
 */

const WIDTH_REST = 100;
const WIDTH_PEAK = 125;
const FALLOFF_PX = 88;
const YROT_MAX = 22;
const XROT_MAX = 14;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function splitWords(text: string): string[] {
  return text.split(/(\s+)/);
}

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [
      ...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
    ].map((s) => s.segment);
  }
  return [...text];
}

function restVariation(): string {
  return `"wdth" ${WIDTH_REST}, "YROT" 0, "XROT" 0`;
}

function applyRest(el: HTMLElement) {
  el.style.fontVariationSettings = restVariation();
  el.style.setProperty("--wdth-scale", "1");
}

export function WidthFollowTitle({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reduceRef = useRef(false);
  const rafRef = useRef(0);
  const ptrRef = useRef({ x: 0, y: 0, inside: false });

  const glyphs = () =>
    headingRef.current?.querySelectorAll<HTMLElement>("[data-vf-glyph]") ?? [];

  const tick = useCallback(() => {
    rafRef.current = 0;
    const nodes = glyphs();
    if (!ptrRef.current.inside || reduceRef.current) {
      nodes.forEach(applyRest);
      return;
    }
    const { x, y } = ptrRef.current;
    for (const el of nodes) {
      const box = el.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const t = Math.max(0, 1 - dist / FALLOFF_PX);
      const eased = t * t * (3 - 2 * t);
      const wdth = WIDTH_REST + (WIDTH_PEAK - WIDTH_REST) * eased;
      const yrot = ((-dx / FALLOFF_PX) * YROT_MAX * eased).toFixed(2);
      const xrot = ((dy / FALLOFF_PX) * XROT_MAX * eased).toFixed(2);
      el.style.fontVariationSettings = `"wdth" ${wdth.toFixed(1)}, "YROT" ${yrot}, "XROT" ${xrot}`;
      el.style.setProperty("--wdth-scale", (wdth / WIDTH_REST).toFixed(4));
    }
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reduceRef.current = mq.matches;
      if (reduceRef.current) {
        ptrRef.current.inside = false;
        glyphs().forEach(applyRest);
        headingRef.current?.removeAttribute("data-tracking");
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function onPointerMove(e: ReactPointerEvent<HTMLHeadingElement>) {
    if (prefersReducedMotion()) return;
    ptrRef.current = { x: e.clientX, y: e.clientY, inside: true };
    headingRef.current?.setAttribute("data-tracking", "");
    schedule();
  }

  function onPointerLeave() {
    ptrRef.current.inside = false;
    headingRef.current?.removeAttribute("data-tracking");
    schedule();
  }

  return (
    <h1
      ref={headingRef}
      className={["display", "misreg", "width-follow", className]
        .filter(Boolean)
        .join(" ")}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {splitWords(children).map((token, i) =>
        /^\s+$/.test(token) ? (
          <span key={i} className="width-follow__space">
            {" "}
          </span>
        ) : (
          <span key={i} className="width-follow__word">
            {graphemes(token).map((g, j) => (
              <span
                key={j}
                data-vf-glyph=""
                className="width-follow__glyph"
                style={{
                  fontVariationSettings: restVariation(),
                  ["--wdth-scale" as string]: 1,
                }}
              >
                {g}
              </span>
            ))}
          </span>
        ),
      )}
    </h1>
  );
}
