import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Small motion primitives used by the landing page and dashboard.
 *
 * Everything here is progressive: an element renders in its final, visible
 * state on the server and on first paint. It only hides itself after mount,
 * once we know it is safe to animate, so a JS/observer failure can never take
 * content away from the user.
 */

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type RevealState = "idle" | "hidden" | "visible";

/** Observes an element and reports when it first enters the viewport. */
export function useInView<T extends Element>(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}) {
  const { threshold = 0.15, rootMargin = "0px 0px -10% 0px", once = true } = options ?? {};
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<RevealState>("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer, or the user asked for reduced motion: stay visible.
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) return;

    // Already on screen at mount — show immediately with no entry animation so
    // above-the-fold content never flashes or waits on an observer callback.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9 && rect.bottom > 0) {
      setState("visible");
      return;
    }

    setState("hidden");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setState("visible");
          if (once) observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, rootMargin, threshold]);

  return { ref, state };
}

/** True once the page has scrolled past `offset` pixels. */
export function useScrolled(offset = 12): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [offset]);

  return scrolled;
}

/**
 * Fades + lifts its children into place the first time they scroll into view.
 * Pass `delay` to stagger siblings.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  distance = 18,
  duration = 650,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
  duration?: number;
}) {
  const { ref, state } = useInView<HTMLDivElement>();
  const armed = state !== "idle";

  return (
    <div
      ref={ref}
      data-reveal={state}
      className={cn(armed && "transition-[opacity,transform]", className)}
      style={{
        opacity: state === "hidden" ? 0 : 1,
        transform: state === "hidden" ? `translate3d(0, ${distance}px, 0)` : "none",
        transitionDuration: armed ? `${duration}ms` : undefined,
        transitionTimingFunction: armed ? EASE_OUT : undefined,
        transitionDelay: state === "visible" ? `${delay}ms` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Counts up to `value` when it scrolls into view. Only used for values that
 * are genuine or explicitly labelled illustrative.
 */
export function CountUp({
  value,
  decimals = 0,
  duration = 900,
  prefix = "",
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const { ref, state } = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const [display, setDisplay] = useState<number | null>(null);

  useEffect(() => {
    if (state !== "visible") return;
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }

    setDisplay(0);
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, state, value]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {(display ?? value).toFixed(decimals)}
      {suffix}
    </span>
  );
}

/**
 * Reports whether the chart line should be drawn, so an SVG path can animate
 * its stroke with `stroke-dashoffset`. Reduced motion is handled in CSS.
 */
export function useDrawOnce<T extends SVGElement>() {
  const { ref, state } = useInView<T>({ threshold: 0.25 });
  return { ref, drawn: state === "visible" };
}

/**
 * Very small vertical parallax for a single hero image.
 *
 * Deliberately conservative: the offset stays within `strength` pixels (pair it
 * with a slight CSS scale so the edges never expose), it reads scroll position
 * inside one rAF frame, and it does nothing at all when the user prefers
 * reduced motion.
 */
export function useParallax<T extends HTMLElement>(strength = 14) {
  const ref = useRef<T | null>(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const centre = rect.top + rect.height / 2;
      const travel = window.innerHeight / 2 + rect.height / 2;
      const progress = Math.max(-1, Math.min(1, (centre - window.innerHeight / 2) / travel));
      setOffset(-progress * strength);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [strength]);

  return { ref, offset };
}
