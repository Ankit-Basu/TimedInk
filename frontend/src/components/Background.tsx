import { lazy, Suspense, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/*
  The WebGL layers are the heaviest things on the page, so each is split into
  its own chunk and loaded after first paint. All three are React Bits
  backgrounds, vendored into components/reactbits.
*/
const PrismaticBurst = lazy(() => import('./reactbits/PrismaticBurst'));
const LightRays = lazy(() => import('./reactbits/LightRays'));
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

      {/* Warm glows: amber top-left, plum right, ember low. */}
      <div className="float-slow absolute -top-48 -left-40 h-[560px] w-[560px] rounded-full bg-ember/20 blur-[140px]" />
      <div
        className="float-slow absolute top-1/4 -right-48 h-[520px] w-[520px] rounded-full bg-plum/20 blur-[150px]"
        style={{ animationDelay: '-3s' }}
      />
      <div className="absolute -bottom-56 left-1/4 h-[460px] w-[460px] rounded-full bg-amber/10 blur-[150px]" />

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
 * The hero's light: a React Bits PrismaticBurst, warm rays fanning out from
 * behind the floating ticket. Absolutely positioned inside the hero so it
 * scrolls away with it instead of following the reader down the page.
 */
export function HeroBurst({ className = '', style }: { className?: string; style?: CSSProperties }) {
  const { webgl, reduceMotion } = useWebGL();
  if (!webgl) return null;

  return (
    <div className={`pointer-events-none absolute ${className}`} style={style} aria-hidden="true">
      <Suspense fallback={null}>
        <PrismaticBurst
          colors={['#ff9d3c', '#ffd27a', '#c25bff', '#5a2bd6', '#3ddbb0']}
          intensity={1.35}
          speed={0.35}
          animationType="rotate3d"
          distort={0}
          rayCount={0}
          centerFade={1}
          grain={0.9}
          glow={0.35}
          quality="high"
          dpr={1}
          mouseInteraction
          mouseStrength={0.25}
          clickBurst={false}
          intro={false}
          paused={reduceMotion}
        />
      </Suspense>
    </div>
  );
}

/** React Bits LightRays, falling from the top of a section like stage light. */
export function SectionRays({ className = '' }: { className?: string }) {
  const { webgl } = useWebGL();
  if (!webgl) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden="true">
      <Suspense fallback={null}>
        <LightRays
          raysOrigin="top-center"
          raysColor="#ffc06b"
          raysSpeed={0.8}
          lightSpread={0.9}
          rayLength={1.4}
          noiseAmount={0.08}
          distortion={0.04}
          followMouse
          mouseInfluence={0.08}
          maxDevicePixelRatio={1}
        />
      </Suspense>
    </div>
  );
}
