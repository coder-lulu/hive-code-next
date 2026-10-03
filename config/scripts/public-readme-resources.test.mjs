import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public README resources', () => {
  it('renders its local media from public product resources without private docs', () => {
    const readme = readFileSync('README.md', 'utf8')
    const media = [...readme.matchAll(/\b(?:src|srcset)="([^"]+)"/g)]
      .flatMap((match) => match[1].split(','))
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target))

    expect(media.length).toBeGreaterThan(0)
    for (const target of media) {
      const normalized = path.posix.normalize(target)
      expect(
        normalized.startsWith('resources/') || normalized.startsWith('src/shared/agent-icons/'),
        target
      ).toBe(true)
      expect(existsSync(path.resolve(target)), target).toBe(true)
    }
  })
})
