import type { ReactNode, ElementType, ComponentPropsWithoutRef } from 'react';

type StarBorderProps<T extends ElementType = 'button'> = {
  as?: T;
  className?: string;
  color?: string;
  speed?: string;
  thickness?: number;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'color' | 'children'>;

/**
 * StarBorder — Animated running-star border effect from react-bits.
 * Two radial-gradient "stars" orbit the border edges giving a
 * subtle premium glow sweep on buttons and cards.
 * @see https://reactbits.dev/components/star-border
 */
export default function StarBorder<T extends ElementType = 'button'>({
  as,
  className = '',
  color = 'white',
  speed = '6s',
  thickness = 1,
  children,
  ...rest
}: StarBorderProps<T>) {
  const Component = as || 'button';

  return (
    <Component
      className={`star-border-container ${className}`}
      style={{ padding: `${thickness}px 0`, ...(rest as Record<string, unknown>).style as object }}
      {...rest}
    >
      <div
        className="border-gradient-bottom"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div
        className="border-gradient-top"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      />
      <div className="star-border-inner">
        {children}
      </div>
    </Component>
  );
}
