import React from 'react';

interface LogoProps {
  /** Size in pixels for the mark */
  size?: number;
  /** Whether to show the "TimedInk" text wordmark */
  showWordmark?: boolean;
  /** Custom class for the wrapper */
  className?: string;
  /** Force monochrome white instead of the brand gradient */
  monochrome?: boolean;
}

/**
 * TimedInk Logo Mark & Wordmark
 *
 * Fuses "perfect timing" with "written communication":
 * - Outer dial represents a precision clock face.
 * - Hour & minute hands rest at 10:10, seamlessly forming the upper fold of an envelope.
 * - The lines sweep down to form a fountain pen nib and envelope seal.
 * - Paired with the "TimedInk" wordmark in Outfit with bold "Timed" and lighter lowercase "ink".
 */
export const TimedInkLogo: React.FC<LogoProps> = ({
  size = 36,
  showWordmark = true,
  className = '',
  monochrome = false,
}) => {
  const gradientId = React.useId();

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <span className="logo-mark" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="shrink-0"
          aria-label="TimedInk Logo"
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="4"
              y1="3"
              x2="28"
              y2="29"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#B794FF" />
              <stop offset="52%" stopColor="#55D6BE" />
              <stop offset="100%" stopColor="#F6C76B" />
            </linearGradient>
          </defs>

          <circle
            cx="16"
            cy="16"
            r="12.6"
            stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
            strokeWidth="2"
            opacity="0.95"
          />
          <path
            d="M8.8 11.2L16 16.6L23.2 11.2"
            stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 11.6V21h14v-9.4M9.4 21L14 16.9M22.6 21L18 16.9"
            stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.86"
          />
          <path
            d="M16 5.8v2.5M26.2 16h-2.5M16 26.2v-2.5M5.8 16h2.5"
            stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
            strokeWidth="1.45"
            strokeLinecap="round"
            opacity="0.7"
          />
          <circle cx="16" cy="16.55" r="1.7" fill={monochrome ? 'currentColor' : '#55D6BE'} />
        </svg>
      </span>

      {showWordmark && (
        <div className="flex flex-col leading-none select-none">
          <span
            className="logo-wordmark tracking-tight text-white flex items-baseline"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            <span className="font-extrabold text-lg text-white">Timed</span>
            <span className="font-semibold text-lg">ink</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default TimedInkLogo;
