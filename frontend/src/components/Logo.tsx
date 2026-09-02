/**
 * Wordmark.
 *
 * A clock hand sweeping through a filled dot — the "timed" half of the name.
 * Flat, monochrome, and it inherits `currentColor`, so it works on any surface
 * without a second asset.
 */
export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-fg">
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-accent"
      >
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M10 5.5V10l3 2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">TimedInk</span>
    </span>
  );
}
