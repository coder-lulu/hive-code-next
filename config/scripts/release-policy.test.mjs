import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/release-policy.yml', 'utf8'))
const script = workflow.jobs.enforce.steps.find((step) => step.name === 'Enforce release policy')
  .with.script
const execute = new (Object.getPrototypeOf(async () => {}).constructor)(
  'github',
  'context',
  'core',
  script
)

async function enforce({ action, tag, author }) {
  const release = { id: 8, tag_name: tag, author: { login: author }, prerelease: false }
  const github = {
    paginate: vi.fn(async () => []),
    rest: {
      repos: {
        listReleases: vi.fn(),
        updateRelease: vi.fn(async () => ({})),
        deleteRelease: vi.fn(async () => ({}))
      },
      git: { deleteRef: vi.fn(async () => ({})) }
    }
  }
  const core = { warning: vi.fn() }
  await execute(
    github,
    {
      repo: { owner: 'coder-lulu', repo: 'hive-code-next' },
      payload: { action, release }
    },
    core
  )
  return { github, core }
}

describe('Hive product release authority', () => {
  it('leaves a human-authored existing release and its tag intact when notes are edited', async () => {
    const { github, core } = await enforce({
      action: 'edited',
      tag: 'v1.5.0',
      author: 'maintainer'
    })
    expect(github.rest.repos.updateRelease).not.toHaveBeenCalled()
    expect(github.rest.repos.deleteRelease).not.toHaveBeenCalled()
    expect(github.rest.git.deleteRef).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('left as-is'))
  })

  it.each([
    'v1.5.0-beta.22',
    'v1.5.0-rc.1',
    'mobile-android-v1.5.0-beta.22',
    'mobile-ios-v1.5.0-rc.1'
  ])('keeps the owned prerelease tag %s authorized', async (tag) => {
    const { github } = await enforce({ action: 'published', tag, author: 'github-actions[bot]' })
    expect(github.rest.repos.deleteRelease).not.toHaveBeenCalled()
    expect(github.rest.git.deleteRef).not.toHaveBeenCalled()
    expect(github.rest.repos.updateRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        prerelease: true,
        make_latest: 'false'
      })
    )
  })

  it('retains bot-only publication authority without trusting a tagger email', async () => {
    const { github } = await enforce({ action: 'published', tag: 'v1.5.0', author: 'maintainer' })
    expect(github.rest.repos.deleteRelease).toHaveBeenCalledWith(
      expect.objectContaining({ release_id: 8 })
    )
    expect(github.rest.git.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'tags/v1.5.0' })
    )
  })
})
