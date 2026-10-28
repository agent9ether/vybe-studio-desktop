// The hosted app wrapped calls in TanStack Start's useServerFn. Locally every
// "server function" is a plain async function that talks to the main process.
export function useServerFn<T>(fn: T): T {
  return fn;
}
