import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';

/**
 * Motion primitives, all on GSAP.
 *
 * One animation engine for the whole app keeps the bundle honest and means
 * every effect shares one ticker — Lenis' smooth scroll, ScrollTrigger reveals
 * and the number tweens all advance on the same frame, so nothing judders
 * against anything else.
 */

gsap.registerPlugin(ScrollTrigger, useGSAP);

export { gsap, ScrollTrigger, useGSAP };

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Smooth, inertial wheel scrolling (Lenis), driven from GSAP's ticker so
 * ScrollTrigger sees every frame Lenis produces. Mounted once per page that
 * scrolls; skipped entirely for reduced-motion users.
 */
export function useSmoothScroll(enabled = true): void {
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;

    const lenis = new Lenis({
      duration: 0.85,
      smoothWheel: true,
      wheelMultiplier: 1.05,
      touchMultiplier: 1.5,
    });
    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(500, 33);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [enabled]);
}

/**
 * Scroll-triggered entrance for everything marked `data-reveal` inside `scope`.
 *
 * Uses ScrollTrigger.batch, so elements that enter together animate together
 * with a stagger, instead of each one owning a trigger and firing on its own.
 * Uses GPU-accelerated transforms instead of expensive filter blur.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useGSAP(
    () => {
      const targets = gsap.utils.toArray<HTMLElement>('[data-reveal]');
      if (targets.length === 0) return;
      if (prefersReducedMotion()) {
        gsap.set(targets, { opacity: 1, y: 0 });
        return;
      }

      gsap.set(targets, { opacity: 0, y: 24, willChange: 'transform, opacity' });
      ScrollTrigger.batch(targets, {
        start: 'top 90%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: 'expo.out',
            stagger: 0.06,
            overwrite: true,
            clearProps: 'willChange',
          }),
      });
    },
    { scope, dependencies: deps },
  );
}

/**
 * Animated number. Tweens from the previous value to the new one, so a poll
 * that changes "12" to "13" counts up rather than snapping.
 */
export function CountUp({
  value,
  duration = 1.1,
  className = '',
  format = (n: number) => Math.round(n).toLocaleString(),
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const current = useRef({ n: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      current.current.n = value;
      el.textContent = format(value);
      return;
    }
    // Count only once the number is on screen — a stat below the fold that
    // finished counting before anyone scrolled to it might as well be static.
    let tween: gsap.core.Tween | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        tween = gsap.to(current.current, {
          n: value,
          duration,
          ease: 'power3.out',
          onUpdate: () => {
            el.textContent = format(current.current.n);
          },
        });
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      tween?.kill();
    };
    // `format` is expected to be stable in intent; re-running on identity
    // changes would restart the tween every render.
  }, [value, duration]);

  return (
    <span ref={ref} className={`tabular-nums ${className}`}>
      {format(0)}
    </span>
  );
}

/**
 * Subtle 3D tilt toward the pointer. Uses quickTo setters, so pointermove only
 * updates two tweens rather than creating new ones every event.
 */
export function useTilt<T extends HTMLElement>(strength = 6) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || window.matchMedia('(pointer: coarse)').matches) return;

    gsap.set(el, { transformPerspective: 900 });
    const rotX = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
    const rotY = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });

    let rect: DOMRect | null = null;
    const onEnter = () => {
      rect = el.getBoundingClientRect();
    };
    const onMove = (e: PointerEvent) => {
      if (!rect || !rect.width || !rect.height) rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      rotY(px * strength);
      rotX(-py * strength);
    };
    const onLeave = () => {
      rect = null;
      rotX(0);
      rotY(0);
    };

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [strength]);

  return ref;
}
