import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Minimal Monochromatic Kinetic Variable Font Title
 *
 * Drives live variable font axes ("wght" 350 -> 800, "wdth" 100 -> 125, letter tracking)
 * based on pointer proximity with smooth cubic easing.
 */

const WGHT_REST = 400;
const WGHT_PEAK = 800;
const WIDTH_REST = 100;
const WIDTH_PEAK = 120;
const FALLOFF_PX = 120;

function reducedMotionQuery(): MediaQueryList | null {
  // jsdom has no matchMedia; treat its absence as "no preference".
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
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
  return `"wght" ${WGHT_REST}`;
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
      const wght = WGHT_REST + (WGHT_PEAK - WGHT_REST) * eased;
      const wdth = WIDTH_REST + (WIDTH_PEAK - WIDTH_REST) * eased;
      el.style.fontVariationSettings = `"wght" ${wght.toFixed(0)}`;
      el.style.setProperty("--wdth-scale", (wdth / WIDTH_REST).toFixed(3));
    }
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    const mq = reducedMotionQuery();
    const sync = () => {
      reduceRef.current = mq?.matches ?? false;
      if (reduceRef.current) {
        ptrRef.current.inside = false;
        glyphs().forEach(applyRest);
        headingRef.current?.removeAttribute("data-tracking");
      }
    };
    sync();
    mq?.addEventListener("change", sync);
    return () => {
      mq?.removeEventListener("change", sync);
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
