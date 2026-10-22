import React, { createContext } from 'react';

/**
 * Creates or retrieves a singleton React Context stored on `globalThis`.
 *
 * This prevents React Context duplication in Vite development environments when
 * relative imports and barrel exports produce separate ES module instances
 * with different query parameters (e.g. `?v=<hash>` vs non-hash).
 *
 * @param key Unique key to identify the context globally on `globalThis`
 * @param defaultValue Default value for the context
 * @param displayName Optional displayName for debugging in React DevTools
 * @returns React.Context<T>
 */
export function createSingletonContext<T>(
  key: string,
  defaultValue: T,
  displayName?: string
): React.Context<T> {
  const globalRef = globalThis as unknown as Record<string, React.Context<T> | undefined>;

  if (!globalRef[key]) {
    const context = createContext<T>(defaultValue);
    if (displayName) {
      context.displayName = displayName;
    }
    globalRef[key] = context;
  }

  return globalRef[key]!;
}

export default createSingletonContext;
