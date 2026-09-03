import { useEffect, useState } from 'react';

/**
 * Trail a rapidly-changing value by `delayMs`.
 *
 * Used for the search box: the input stays fully responsive while the query
 * key — and therefore the network request — only moves once typing settles.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
