import React from 'react';

interface LogoProps {
  /** Size in pixels for the mark */
  size?: number;
  /** Whether to show the "TimedInk" text wordmark */
  showWordmark?: boolean;
  /** Custom class for the wrapper */
  className?: string;
  /** Force monochrome white instead of violet-fuchsia gradient */
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
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0 transition-transform duration-300 hover:scale-105"
        aria-label="TimedInk Logo"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="2"
            y1="2"
            x2="30"
            y2="30"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#D946EF" />
          </linearGradient>
        </defs>

        {/* Outer Clock Dial */}
        <circle
          cx="16"
          cy="16"
          r="13.5"
          stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
          strokeWidth="2.2"
          className="transition-all"
        />

        {/* 12, 3, 6, 9 subtle tick marks */}
        <line x1="16" y1="4.5" x2="16" y2="6" stroke={monochrome ? 'currentColor' : '#8B5CF6'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="27.5" y1="16" x2="26" y2="16" stroke={monochrome ? 'currentColor' : '#D946EF'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="16" y1="27.5" x2="16" y2="26" stroke={monochrome ? 'currentColor' : '#D946EF'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <line x1="4.5" y1="16" x2="6" y2="16" stroke={monochrome ? 'currentColor' : '#8B5CF6'} strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

        {/* Clock Hands at 10:10 / Envelope Flap & Pen Nib */}
        <path
          d="M9.5 11.5L16 16.5L22.5 11.5"
          stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9.5 11.5L16 22.5L22.5 11.5"
          stroke={monochrome ? 'currentColor' : `url(#${gradientId})`}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />

        {/* Center Ink Pivot */}
        <circle
          cx="16"
          cy="16.5"
          r="1.75"
          fill={monochrome ? 'currentColor' : '#D946EF'}
        />
      </svg>

      {showWordmark && (
        <div className="flex flex-col leading-none select-none">
          <span
            className="tracking-tight text-white flex items-baseline"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            <span className="font-extrabold text-lg text-white">Timed</span>
            <span className="font-medium text-lg text-fuchsia-400">ink</span>
          </span>
        </div>
      )}
    </div>
  );
};

export default TimedInkLogo;
