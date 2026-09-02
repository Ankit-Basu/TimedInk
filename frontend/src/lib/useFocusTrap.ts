import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keep Tab inside a dialog while it is open, and put focus back where it came
 * from when it closes.
 *
 * `aria-modal="true"` is a promise to assistive technology that the rest of the
 * page is inert. Without this the promise is a lie: Tab walks straight out of
 * the dialog into the table behind it, and closing the dialog drops focus onto
 * `<body>`, which sends the next Tab back to the top of the document.
 *
 * Deliberately hand-rolled rather than pulling in a focus-management library —
 * it is one dialog, and the whole behaviour is thirty lines.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        // offsetParent is null for anything display:none — skip hidden controls.
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement;

      // Wrap in both directions, and pull focus back in if it has escaped.
      if (event.shiftKey && (activeEl === first || !container.contains(activeEl))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeEl === last || !container.contains(activeEl))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Return focus to the trigger so the keyboard user does not lose their place.
      previouslyFocused.current?.focus?.();
    };
  }, [active]);

  return containerRef;
}
