import { useEffect, useRef, useState } from 'react';
import { gsap, prefersReducedMotion, useTilt } from '../lib/motion';

/**
 * The hero's floating ticket: one scheduled email drawn as a boarding pass.
 *
 * Its status walks QUEUED → SENDING → SENT on a loop, which is the whole
 * product in one object — the reader sees an email wait for its moment and go.
 */
const STAGES = [
  { label: 'Queued', tone: 'text-st-queued border-st-queued/30 bg-st-queued/10', dot: 'bg-st-queued' },
  { label: 'Sending', tone: 'text-st-sending border-st-sending/30 bg-st-sending/10', dot: 'bg-st-sending' },
  { label: 'Sent', tone: 'text-teal border-teal/35 bg-teal/10', dot: 'bg-teal' },
] as const;

export default function SendPass() {
  const tiltRef = useTilt<HTMLDivElement>(7);
  const handRef = useRef<SVGLineElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setStage(2);
      return;
    }
    const id = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2200);
    // The clock hand sweeps continuously — time passing until the send.
    const sweep = gsap.to(handRef.current, {
      rotation: 360,
      transformOrigin: '50% 100%',
      duration: 6.6,
      ease: 'none',
      repeat: -1,
    });
    return () => {
      clearInterval(id);
      sweep.kill();
    };
  }, []);

  const current = STAGES[stage]!;

  return (
    <div ref={tiltRef} className="will-change-transform">
      <div className="float-slow" style={{ animationDuration: '7s' }}>
        <div className="glass-strong relative flex w-[min(460px,88vw)] -rotate-[5deg] overflow-hidden rounded-[22px] shadow-[0_40px_100px_-30px_rgb(0_0_0/0.9)]">
          {/* Live edge. */}
          <span className="absolute top-6 bottom-6 left-0 w-[3px] rounded-r-full bg-teal shadow-[0_0_18px_rgb(61_219_176/0.8)]" aria-hidden="true" />

          <div className="min-w-0 flex-1 py-6 pr-5 pl-7">
            <p className="label !text-[9.5px]">Send pass · email-7KQ4ZP</p>
            <p className="headline mt-2 text-[1.75rem] leading-[1.05] text-ink">
              Quick question about your Q4 pipeline
            </p>
            <p className="mono mt-2 truncate text-[11px] text-ink-3">to ava@acme.io · via ben@timedink.dev</p>

            <dl className="mt-5 grid grid-cols-3 gap-3">
              {[
                ['Date', 'Tue 13 Oct'],
                ['Time', '16:00 IST'],
                ['Attempt', '1 / 3'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label !text-[9px]">{k}</dt>
                  <dd className="mono mt-1 text-[13px] text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Perforation, with the notches punched out of the card edges. */}
          <div className="relative w-px">
            <span className="perforation absolute inset-y-4 left-0 w-px" />
            <span className="absolute -top-3 -left-3 h-6 w-6 rounded-full bg-night" />
            <span className="absolute -bottom-3 -left-3 h-6 w-6 rounded-full bg-night" />
          </div>

          <div className="flex w-[118px] shrink-0 flex-col items-center justify-center gap-4 px-4 py-6">
            <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden="true">
              <circle cx="32" cy="32" r="29" fill="rgb(0 0 0 / 0.3)" stroke="rgb(255 240 220 / 0.18)" strokeWidth="1.5" />
              {Array.from({ length: 12 }, (_, i) => (
                <line
                  key={i}
                  x1="32"
                  y1="6"
                  x2="32"
                  y2={i % 3 === 0 ? 11 : 9}
                  stroke="rgb(255 240 220 / 0.4)"
                  strokeWidth="1.5"
                  transform={`rotate(${i * 30} 32 32)`}
                />
              ))}
              <line ref={handRef} x1="32" y1="32" x2="32" y2="12" stroke="#ffb547" strokeWidth="2" strokeLinecap="round" />
              <circle cx="32" cy="32" r="2.5" fill="#ffb547" />
            </svg>

            <span
              key={current.label}
              className={`mono inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors duration-500 ${current.tone}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor] ${current.dot}`} />
              {current.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
