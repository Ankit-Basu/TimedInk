/**
 * Wordmark.
 *
 * A clock hand inside a ring — the "timed" half of the name — set against the
 * display serif. The mark inherits `currentColor` so it needs no second asset.
 */
export default function Logo({ size = 18 }: { size?: number }) {
  return (
    <span className="flex items-baseline gap-2.5 text-ink">
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0 translate-y-[2px]"
      >
        <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.3" />
        <path
          d="M10 5.4V10.2l3.1 2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="display text-[19px] tracking-tight">TimedInk</span>
    </span>
  );
}
