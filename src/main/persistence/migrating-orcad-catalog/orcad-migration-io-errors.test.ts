import { afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { OrcadTerminalRestoreHintStore } from './orcad-terminal-restore-hint-store'
import {
  orcadMigrationStagedFileSize,
  orcadMigrationFileMatches,
  pruneOrcadMigrationKeyedDirectories
} from './orcad-migration-staged-file'
vi.mock('node:fs', async (original) => ({ ...(await original<typeof fs>()) }))
afterEach(() => vi.restoreAllMocks())
const failure = (code: string) => Object.assign(new Error(code), { code })
describe('migration filesystem failures preserve evidence', () => {
  it.each(['EACCES', 'EIO'])(
    'does not turn %s into absent staging or successful cleanup',
    (code) => {
      const error = failure(code)
      vi.spyOn(fs, 'statSync').mockImplementation(() => {
        throw error
      })
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw error
      })
      vi.spyOn(fs, 'readdirSync').mockImplementation(() => {
        throw error
      })
      expect(() => orcadMigrationStagedFileSize('/stage', 100)).toThrow(error)
      expect(() => orcadMigrationFileMatches('/stage', { byteLength: 0, sha256: '' })).toThrow(
        error
      )
      expect(() => pruneOrcadMigrationKeyedDirectories('/stage', [])).toThrow(error)
      expect(() =>
        new OrcadTerminalRestoreHintStore('/stage').hasInstalledMigration('a'.repeat(32))
      ).toThrow(error)
    }
  )
  it('initializes only when the store is absent', () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw failure('ENOENT')
    })
    expect(new OrcadTerminalRestoreHintStore('/stage').hasInstalledMigration('a'.repeat(32))).toBe(
      false
    )
  })
  it.each(['not json', '{"version":2,"hints":[],"installedMigrationKeys":["invalid"]}'])(
    'refuses a corrupt store without writing: %s',
    (text) => {
      vi.spyOn(fs, 'readFileSync').mockReturnValue(text)
      const write = vi.spyOn(fs, 'writeFileSync')
      const store = new OrcadTerminalRestoreHintStore('/stage')
      expect(() =>
        store.install({ migrationKey: 'a'.repeat(32), migrationId: 'move' }, [], 0)
      ).toThrow('orcad_migration_terminal_restore_hint_store_invalid')
      expect(write).not.toHaveBeenCalled()
    }
  )
})
