// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentVersionInformation } from './AgentVersionInformation'

describe('Agent version source presentation', () => {
  afterEach(cleanup)
  it.each([
    ['npm-latest', 'npm'],
    ['github-release', 'GitHub'],
    ['pypi-latest', 'PyPI']
  ] as const)(
    'labels %s from its actual upstream without npm-specific success claims',
    (channel, label) => {
      render(
        <AgentVersionInformation
          onRetry={() => {}}
          snapshot={{
            current: { status: 'ready', version: '1.2.3' },
            latest: {
              status: 'ready',
              version: '1.2.3',
              channel,
              sourceUrl: 'https://example.test/releases'
            },
            currentLoading: false,
            latestLoading: false
          }}
        />
      )
      expect(screen.getByText(`(${label})`)).toBeTruthy()
      expect(screen.queryByText('Latest on npm')).toBeNull()
      if (label !== 'npm') {
        expect(screen.queryByText('(npm)')).toBeNull()
      }
    }
  )
})
