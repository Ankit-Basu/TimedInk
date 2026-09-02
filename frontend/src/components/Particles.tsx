import { useEffect, useRef } from 'react';
import { Renderer, Camera, Geometry, Program, Mesh } from 'ogl';

const DEFAULT_COLORS = [
  '#ffffff',
  '#c084fc',
  '#a855f7',
  '#818cf8',
  '#38bdf8',
  '#e879f9',
];

const hexToRgb = (hex: string): [number, number, number] => {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const int = parseInt(hex.slice(0, 6), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [r, g, b];
};

const vertex = /* glsl */ `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;

  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;

  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vRandom = random;
    vColor = color;

    vec3 pos = position * uSpread;
    pos.z *= 8.0;

    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.15, 0.9, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.15, 0.9, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.15, 0.9, random.z);

    vec4 mvPos = viewMatrix * mPos;

    float dist = max(length(mvPos.xyz), 1.0);
    float size = uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5));
    gl_PointSize = clamp(size / dist, 3.5, 32.0);

    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragment = /* glsl */ `
  precision highp float;

  uniform float uTime;
  varying vec4 vRandom;
  varying vec3 vColor;

  void main() {
    vec2 uv = gl_PointCoord.xy;
    float d = length(uv - vec2(0.5));
    if (d > 0.5) discard;

    // High-intensity glowing star core with smooth radial falloff
    float core = smoothstep(0.5, 0.06, d);
    float glow = exp(-d * 4.2);
    float alpha = clamp(core * 0.85 + glow * 0.5, 0.0, 1.0);

    vec3 col = vColor + 0.12 * sin(uv.yxx * 3.0 + uTime * 2.0 + vRandom.y * 6.28);
    gl_FragColor = vec4(col, alpha);
  }
`;

interface ParticlesProps {
  particleCount?: number;
  particleSpread?: number;
  speed?: number;
  particleColors?: string[];
  moveParticlesOnHover?: boolean;
  particleHoverFactor?: number;
  particleBaseSize?: number;
  sizeRandomness?: number;
  cameraDistance?: number;
  disableRotation?: boolean;
  pixelRatio?: number;
  fpsLimit?: number;
  className?: string;
}

/**
 * Particles — High-performance, high-intensity WebGL particle field from react-bits.
 * Optimized with stable color keys, clamped point sizes for sharp visibility,
 * efficient discard fill rate, and zero WebGL context thrashing.
 */
const Particles = ({
  particleCount = 240,
  particleSpread = 11,
  speed = 0.12,
  particleColors,
  moveParticlesOnHover = false,
  particleHoverFactor = 1,
  particleBaseSize = 140,
  sizeRandomness = 0.7,
  cameraDistance = 18,
  disableRotation = false,
  pixelRatio,
  fpsLimit = 36,
  className = '',
}: ParticlesProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });

  // Serialize colors so inline arrays don't cause useEffect to re-run on every render
  const colorsKey = (particleColors || DEFAULT_COLORS).join(',');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrowScreen = window.matchMedia('(max-width: 720px)').matches;
    const dpr = pixelRatio ?? Math.min(window.devicePixelRatio || 1, narrowScreen ? 1 : 1.35);
    const renderEveryMs = 1000 / Math.max(12, Math.min(60, reducedMotion ? 12 : fpsLimit));

    const renderer = new Renderer({ dpr, depth: false, alpha: true, powerPreference: 'low-power' });
    const gl = renderer.gl;
    container.appendChild(gl.canvas);
    gl.clearColor(0, 0, 0, 0);

    const camera = new Camera(gl, { fov: 15 });
    camera.position.set(0, 0, cameraDistance);

    const resize = () => {
      if (!container) return;
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      camera.perspective({ aspect: gl.canvas.width / Math.max(gl.canvas.height, 1) });
    };
    window.addEventListener('resize', resize, { passive: true });
    resize();

    let cachedRect: DOMRect | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      if (!cachedRect) cachedRect = container.getBoundingClientRect();
      const x = ((e.clientX - cachedRect.left) / cachedRect.width) * 2 - 1;
      const y = -(((e.clientY - cachedRect.top) / cachedRect.height) * 2 - 1);
      mouseRef.current = { x, y };
    };

    if (moveParticlesOnHover) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
    }

    const count = reducedMotion ? Math.min(40, particleCount) : narrowScreen ? Math.min(90, particleCount) : particleCount;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count * 4);
    const colors = new Float32Array(count * 3);
    const palette = colorsKey.split(',');

    for (let i = 0; i < count; i++) {
      let x: number, y: number, z: number, len: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        len = x * x + y * y + z * z;
      } while (len > 1 || len === 0);
      const r = Math.cbrt(Math.random());
      positions.set([x * r, y * r, z * r], i * 3);
      randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      const col = hexToRgb(palette[Math.floor(Math.random() * palette.length)]!);
      colors.set(col, i * 3);
    }

    const geometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      random: { size: 4, data: randoms },
      color: { size: 3, data: colors },
    });

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: particleSpread },
        uBaseSize: { value: particleBaseSize * dpr },
        uSizeRandomness: { value: sizeRandomness },
      },
      transparent: true,
      depthTest: false,
    });

    const particles = new Mesh(gl, { mode: gl.POINTS, geometry, program });

    let animationFrameId: number;
    let lastTime = performance.now();
    let lastRender = 0;
    let elapsed = 0;

    const update = (t: number) => {
      animationFrameId = requestAnimationFrame(update);

      if (document.hidden) {
        lastTime = t;
        return;
      }

      if (t - lastRender < renderEveryMs) return;
      lastRender = t;

      const delta = Math.min(t - lastTime, 100); // cap max delta to prevent leaps
      lastTime = t;
      elapsed += delta * speed;

      program.uniforms.uTime.value = elapsed * 0.001;

      if (moveParticlesOnHover) {
        particles.position.x = -mouseRef.current.x * particleHoverFactor;
        particles.position.y = -mouseRef.current.y * particleHoverFactor;
      }

      if (!disableRotation) {
        particles.rotation.x = Math.sin(elapsed * 0.0002) * 0.1;
        particles.rotation.y = Math.cos(elapsed * 0.0005) * 0.15;
        particles.rotation.z += 0.01 * speed;
      }

      renderer.render({ scene: particles, camera });
    };

    animationFrameId = requestAnimationFrame(update);

    return () => {
      window.removeEventListener('resize', resize);
      if (moveParticlesOnHover) {
        window.removeEventListener('mousemove', handleMouseMove);
      }
      cancelAnimationFrame(animationFrameId);
      if (container.contains(gl.canvas)) {
        container.removeChild(gl.canvas);
      }
    };
  }, [
    particleCount,
    particleSpread,
    speed,
    moveParticlesOnHover,
    particleHoverFactor,
    particleBaseSize,
    sizeRandomness,
    cameraDistance,
    disableRotation,
    pixelRatio,
    fpsLimit,
    colorsKey,
  ]);

  return <div ref={containerRef} className={`relative w-full h-full ${className}`} />;
};

export default Particles;
