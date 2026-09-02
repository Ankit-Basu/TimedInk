import { useRef, type MouseEvent, type ReactNode } from 'react';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  /** Color of the spotlight glow, e.g. 'rgba(139, 92, 246, 0.25)' */
  spotlightColor?: string;
  /** Size of the spotlight radius in px */
  spotlightSize?: number;
}

/**
 * SpotlightCard — Pointer-reactive radial glow card from react-bits.
 * Tracks mouse position over the card and renders a radial gradient
 * spotlight that follows the cursor, making the card feel alive.
 * @see https://reactbits.dev/components/spotlight-card
 */
export default function SpotlightCard({
  children,
  className = '',
  spotlightColor = 'rgba(255, 255, 255, 0.15)',
  spotlightSize = 280,
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    const spotlight = spotlightRef.current;
    if (!card || !spotlight) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    spotlight.style.background = `radial-gradient(${spotlightSize}px circle at ${x}px ${y}px, ${spotlightColor}, transparent)`;
    spotlight.style.opacity = '1';
  };

  const handleMouseLeave = () => {
    const spotlight = spotlightRef.current;
    if (spotlight) spotlight.style.opacity = '0';
  };

  return (
    <div
      ref={cardRef}
      className={`spotlight-card ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div
        ref={spotlightRef}
        className="spotlight-card-glow"
        style={{ opacity: 0 }}
      />
      <div className="spotlight-card-content">{children}</div>
    </div>
  );
}
