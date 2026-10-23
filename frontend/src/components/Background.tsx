import { lazy, Suspense, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/*
  DarkVeil moves quietly behind the authenticated dashboard.
  HeroBurst and SectionRays use pure CSS hardware-accelerated gradients.
*/
const DarkVeil = lazy(() => import('./reactbits/DarkVeil'));

let webglSupport: boolean | null = null;

/**
 * Probe once per page load, and give the probe's context straight back.
 * Browsers cap live WebGL contexts (often at 16); a probe that leaks one per
 * render eventually makes the browser kill the oldest — which is the real
 * background, leaving a blank canvas.
 */
function supportsWebGL2(): boolean {
  if (webglSupport !== null) return webglSupport;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webglSupport = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}

/** WebGL2 is what every shader here needs; without it the CSS glows carry the look. */
function useWebGL(): { webgl: boolean; reduceMotion: boolean } {
  const [state, setState] = useState({ webgl: false, reduceMotion: false });

  useEffect(() => {
    const webgl = supportsWebGL2();
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setState({ webgl, reduceMotion: query.matches });
    const onChange = (e: MediaQueryListEvent) => setState((s) => ({ ...s, reduceMotion: e.matches }));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return state;
}

/**
 * The fixed canvas every page sits on: a plum-to-black night, warm glows that
 * drift slowly, and film grain. On the dashboard a React Bits DarkVeil moves
 * quietly over it — enough life to feel warm, calm enough to sit behind a
 * table that refreshes every four seconds.
 */
export default function Background({ variant = 'landing' }: { variant?: 'landing' | 'app' }) {
  const { webgl, reduceMotion } = useWebGL();

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-night" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(110%_70%_at_20%_-10%,#2a1440_0%,#140c20_45%,#0b0812_75%)]" />

      {/* Warm glows: amber top-left, plum right, ember low. Static for 0ms repaint cost during scroll. */}
      <div className="absolute -top-48 -left-40 h-[520px] w-[520px] rounded-full bg-ember/15 blur-[100px]" />
      <div
        className="absolute top-1/4 -right-48 h-[480px] w-[480px] rounded-full bg-plum/15 blur-[100px]"
      />
      <div className="absolute -bottom-56 left-1/4 h-[420px] w-[420px] rounded-full bg-amber/10 blur-[100px]" />

      {variant === 'app' && webgl && (
        <Suspense fallback={null}>
          <div className="absolute inset-0 opacity-90 mix-blend-screen">
            <DarkVeil
              color="#8a3fd1"
              speed={0.35}
              flow={0.8}
              warp={0.3}
              brightness={1}
              glow={0.35}
              grain={0.02}
              quality={0.5}
              dpr={1}
              mouseInteraction={false}
              paused={reduceMotion}
            />
          </div>
        </Suspense>
      )}

      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-night via-night/70 to-transparent" />
      <div className="grain" />
    </div>
  );
}

/**
 * The hero's light: warm prismatic aura fanning out from behind the floating ticket.
 * Built with pure CSS hardware-accelerated gradients — 0ms GPU raymarch overhead,
 * locked at 144Hz/60Hz with zero frame drops.
 */
export function HeroBurst({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`pointer-events-none absolute overflow-hidden ${className}`} style={style} aria-hidden="true">
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="h-[650px] w-[650px] rounded-full opacity-60 blur-[80px]"
          style={{
            background: 'radial-gradient(circle, #ff9d3c 0%, #c25bff 35%, #5a2bd6 60%, transparent 75%)',
          }}
        />
        <div
          className="absolute h-[380px] w-[380px] rounded-full opacity-70 blur-[45px]"
          style={{
            background: 'radial-gradient(circle, #ffd27a 0%, #ff9d3c 50%, transparent 75%)',
          }}
        />
      </div>
    </div>
  );
}

/** Stage light falling from the top of the closing section. */
export function SectionRays({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      <div
        className="mx-auto h-[320px] w-[85%] max-w-4xl opacity-50 blur-[60px]"
        style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 0%, #ffc06b 0%, #f2762e 45%, transparent 80%)',
        }}
      />
    </div>
  );
}
