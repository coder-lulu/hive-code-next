const activeAccounts = new Set<string>()
const MAX_ACTIVE_ACCOUNTS = 64

/** Bounds active client streams in this Host process; it does not prove upstream billing stopped. */
export function acquireTaskModelAccountStream(accountId: string): () => void {
  if (activeAccounts.has(accountId) || activeAccounts.size >= MAX_ACTIVE_ACCOUNTS) {
    throw new Error('TASK_MODEL_ACCOUNT_BUSY')
  }
  activeAccounts.add(accountId)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    activeAccounts.delete(accountId)
  }
}
