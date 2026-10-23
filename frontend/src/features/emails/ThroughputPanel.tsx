import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { CountUp } from '../../lib/motion';

/**
 * The pacing rules the worker is enforcing right now, read from the API rather
 * than restated in copy — so if someone changes MAX_EMAILS_PER_HOUR, this card
 * changes with it.
 */
export default function ThroughputPanel({ pollIntervalMs }: { pollIntervalMs: number }) {
  const { data } = useQuery({
    queryKey: ['throughput'],
    queryFn: () => api.throughput(),
    refetchInterval: pollIntervalMs,
  });

  const used = data?.usedThisHour ?? 0;
  const max = data?.maxPerHour ?? 0;
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

  // Ring geometry: a 44px-radius circle, stroked to the share of the hour used.
  const R = 44;
  const C = 2 * Math.PI * R;

  return (
    <section className="glass rounded-3xl p-6" aria-labelledby="throughput-title">
      <h2 id="throughput-title" className="headline text-[1.45rem]">
        Throughput this hour
      </h2>

      <div className="mt-5 flex items-center gap-5">
        <div className="relative h-[108px] w-[108px] shrink-0">
          <svg viewBox="0 0 108 108" className="h-full w-full -rotate-90" aria-hidden="true">
            <defs>
              <linearGradient id="tp-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#ffe0a3" />
                <stop offset="50%" stopColor="#ffb547" />
                <stop offset="100%" stopColor="#f2762e" />
              </linearGradient>
            </defs>
            <circle cx="54" cy="54" r={R} fill="none" stroke="rgb(255 240 220 / 0.08)" strokeWidth="8" />
            <circle
              cx="54"
              cy="54"
              r={R}
              fill="none"
              stroke="url(#tp-g)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C - (C * pct) / 100}
              className="transition-[stroke-dashoffset] duration-1000 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="headline text-3xl">
              <CountUp value={used} />
            </span>
            <span className="mono text-[10px] text-ink-3">of {max || '—'}</span>
          </div>
        </div>

        <dl className="min-w-0 space-y-2.5 text-xs">
          <Row label="Per sender" value={data ? `${data.maxPerHourPerSender}/h` : '—'} />
          <Row label="Min gap" value={data ? `${(data.minSendDelayMs / 1000).toFixed(1)}s` : '—'} />
          <Row label="Concurrency" value={data ? `${data.workerConcurrency} jobs` : '—'} />
        </dl>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-ink-3">
        Over a limit, a job moves to the next hour window — delayed, never dropped.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label">{label}</dt>
      <dd className="mono text-ink">{value}</dd>
    </div>
  );
}
