import { useEffect } from 'react';

const BASE = 'TimedInk';

/**
 * Set the browser tab title for a route.
 *
 * Worth the six lines: with several tabs open, "TimedInk" on every one of them
 * is useless, and the title is also what a screen reader announces on
 * navigation — in a SPA nothing else signals that the page changed.
 */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
  }, [title]);
}
