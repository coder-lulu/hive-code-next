/** Scan only the account currently authenticated by this Runtime, with bounded pages and claims. */
export function createTaskDispatchRecovery({ repository, createClient, recover, start, isClosed }) {
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
        const awaitingStart = (task) =>
          task.binding &&
          task.run_scope?.kind === 'workbenchCase' &&
          task.generation == null &&
          task.run_status === 'queued' &&
          !task.cancel_requested &&
          task.execution_stage !== 'outcome_unknown'
        const tasks = page.items.filter((task) =>
          task.binding
            ? task.binding.command.runtimeRecordId === owner.runtimeRecordId &&
              (awaitingStart(task) ||
                task.generation != null ||
                task.run_status !== 'queued' ||
                task.cancel_requested)
            : Boolean(task.prepareRefs) && task.run_status === 'queued' && !task.cancel_requested
        )
        let index = 0
        await Promise.allSettled(
          Array.from({ length: Math.min(4, tasks.length) }, async () => {
            while (index < tasks.length && !stopped && !isClosed()) {
              const task = tasks[index++]
              await (task.binding && !awaitingStart(task) ? recover : start)(
                owner.accountId,
                task.id,
                task.run_id
              ).catch(() => {})
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
