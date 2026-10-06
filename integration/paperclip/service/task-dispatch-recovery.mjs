/** Scan only the account currently authenticated by this Runtime, with bounded pages and claims. */
export function createTaskDispatchRecovery({ repository, createClient, recover, isClosed }) {
  let flight,
    timer,
    stopped = false,
    started = false
  const check = () => {
    if (stopped || isClosed()) {
      return Promise.resolve()
    }
    return (flight ??= (async () => {
      const client = await createClient()
      const owner = await client.owner()
      let after
      do {
        if (stopped || isClosed()) {
          return
        }
        const page = await repository.listRecoverableRuns(owner.accountId, { after, limit: 32 })
        const tasks = page.items.filter(
          (task) =>
            task.binding.command.runtimeRecordId === owner.runtimeRecordId &&
            (task.generation != null || task.run_status !== 'queued' || task.cancel_requested)
        )
        let index = 0
        await Promise.allSettled(
          Array.from({ length: Math.min(4, tasks.length) }, async () => {
            while (index < tasks.length && !stopped && !isClosed()) {
              const task = tasks[index++]
              await recover(owner.accountId, task.id, task.run_id).catch(() => {})
            }
          })
        )
        after = page.nextCursor ?? undefined
      } while (after)
    })()
      .catch(() => {})
      .finally(() => {
        flight = null
      }))
  }
  const arm = () => {
    if (stopped || isClosed()) {
      return
    }
    timer = setTimeout(() => {
      void check().finally(arm)
    }, 5000)
    timer.unref?.()
  }
  return {
    check,
    start() {
      if (started || stopped || isClosed()) {
        return
      }
      started = true
      void check().finally(arm)
    },
    async close() {
      stopped = true
      clearTimeout(timer)
      await flight
    }
  }
}
