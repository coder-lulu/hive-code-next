import { vi } from 'vitest'
import Database from '../sqlite/sync-database'
import { journalDatabasePath } from '../native-chat/agent-session-journal/journal-host-database'
import { openTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { createTaskModelDispatchFixture } from '../tasks/task-model-dispatch.test-fixture'
import { readPersistedTestAgentSessionStore } from './agent-session-record-store-test-harness'

export async function createUnconfirmedTaskSqlFixture(
  directory: string,
  committed: boolean,
  reusedError = false
) {
  const fixture = await createTaskModelDispatchFixture(directory)
  const database = openTestJournalHostDatabase(directory)
  if (reusedError) {
    const error = new Error('task-sql-unconfirmed')
    try {
      database.transaction(() => {
        throw error
      })
    } catch (thrown) {
      if (thrown !== error) {
        throw thrown
      }
    }
    const transaction = database.transaction.bind(database)
    vi.spyOn(database, 'transaction').mockImplementationOnce((run) => {
      transaction(run)
      throw error
    })
    return { fixture, database, persisted: () => readPersistedTestAgentSessionStore(directory) }
  }
  const exec = database.db.exec.bind(database.db)
  let first = true
  vi.spyOn(database.db, 'exec').mockImplementation((sql) => {
    if (sql === 'COMMIT' && first) {
      first = false
      if (committed) {
        exec(sql)
      }
      throw new Error('task-sql-unconfirmed')
    }
    return exec(sql)
  })
  return { fixture, database, persisted: () => readPersistedTestAgentSessionStore(directory) }
}

export async function writeExternalTaskCounter(directory: string, sameTask: boolean) {
  const persisted = await readPersistedTestAgentSessionStore(directory)
  const outsider = new Database(journalDatabasePath(directory), { fileMustExist: true })
  try {
    if (sameTask) {
      const tasks = Object.fromEntries(
        Object.entries(persisted.taskExecutions).map(([key, task]) => [
          key,
          { ...task, modelDispatchAttempts: 1, revision: task.revision + 1 }
        ])
      )
      outsider.prepare('UPDATE agent_session_store_meta SET value = ? WHERE key = ?').run(
        JSON.stringify({
          hostId: persisted.hostId,
          hiveSessions: persisted.hiveSessions,
          taskExecutions: tasks
        }),
        'hive_runtime_state'
      )
    } else {
      outsider
        .prepare('INSERT INTO agent_session_store_meta (key, value) VALUES (?, ?)')
        .run('unrelated-after-rollback', '1')
    }
  } finally {
    outsider.close()
  }
}
