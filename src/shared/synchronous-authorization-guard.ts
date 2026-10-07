/** A synchronous Host authorization port succeeds only by returning undefined. */
export function assertSynchronousAuthorization(check: () => void, refuse: () => never): void {
  const result: unknown = check()
  if (result !== undefined) {
    // Observe async denial without treating a pending or fulfilled Promise as authorization.
    void Promise.resolve(result).catch(() => undefined)
    refuse()
  }
}
