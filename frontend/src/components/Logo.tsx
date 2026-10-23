/**
 * Wordmark.
 *
 * A clock hand inside a ring — the "timed" half of the name — stroked with the
 * brand gradient and set on a small glass tile, so it reads on any part of the
 * aurora behind it.
 */
export default function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <span
        className="glass grid shrink-0 place-items-center rounded-[10px]"
        style={{ width: size, height: size }}
      >
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="logo-g" x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ffe0a3" />
              <stop offset="0.5" stopColor="#ffb547" />
              <stop offset="1" stopColor="#f2762e" />
            </linearGradient>
          </defs>
          <circle cx="10" cy="10" r="7.6" stroke="url(#logo-g)" strokeWidth="1.6" />
          <path
            d="M10 5.6V10.2l3 1.9"
            stroke="url(#logo-g)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="text-[17px] font-semibold tracking-tight">
        Timed<span className="display text-[19px] font-normal text-ink-2">Ink</span>
      </span>
    </span>
  );
}
