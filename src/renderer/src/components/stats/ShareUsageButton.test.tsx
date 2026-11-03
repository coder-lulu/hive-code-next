// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShareUsageButton } from './ShareUsageButton'
import { buildUsageShareText } from './share-card-utils'
import type { ShareUsageCardProps } from './ShareUsageCard'

const links = vi.hoisted((): { social: string | null } => ({
  social: 'https://x.com/product_fixture'
}))
vi.mock('@/product-links', () => ({ PRODUCT_PUBLIC_LINKS: links }))
vi.mock('html-to-image', () => ({ toPng: vi.fn() }))
const openUrl = vi.fn().mockResolvedValue(undefined)
const props: ShareUsageCardProps = {
  provider: 'codex',
  range: '7d',
  daily: [],
  summary: {
    scope: 'all',
    range: '7d',
    sessions: 2,
    events: 3,
    inputTokens: 200,
    outputTokens: 120,
    cachedInputTokens: 100,
    reasoningOutputTokens: 50,
    totalTokens: 320,
    estimatedCostUsd: 0.13,
    hasUnpricedModels: false,
    topModel: 'gpt-5.4',
    topProject: null,
    hasAnyCodexData: true
  }
}
beforeEach(() => {
  links.social = 'https://x.com/product_fixture'
  Object.defineProperty(window, 'api', { configurable: true, value: { shell: { openUrl } } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
async function openShare(data: ShareUsageCardProps = props) {
  render(<ShareUsageButton {...data} />)
  fireEvent.click(screen.getByRole('button', { name: 'Share usage' }))
  return screen.findByRole('button', { name: 'Share on X' })
}
it('opens X with the actual localized helper text and inclusive provider totals', async () => {
  fireEvent.click(await openShare())
  await waitFor(() => expect(openUrl).toHaveBeenCalledOnce())
  const url = new URL(openUrl.mock.calls[0][0])
  expect(url.origin + url.pathname).toBe('https://x.com/intent/post')
  expect(url.searchParams.get('text')).toBe(buildUsageShareText(props))
  expect(url.searchParams.get('text')).toContain('320 tokens')
  expect(url.searchParams.get('text')).not.toContain('@orca_build')
})
it('opens the configured non-X product destination', async () => {
  links.social = 'https://example.org/product_fixture'
  fireEvent.click(await openShare())
  await waitFor(() => expect(openUrl).toHaveBeenCalledWith(links.social))
})
it('omits the external share action when the product has no social destination', async () => {
  links.social = null
  render(<ShareUsageButton {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Share usage' }))
  await screen.findByRole('button', { name: 'Copy image' })
  expect(screen.queryByRole('button', { name: 'Share on X' })).not.toBeInTheDocument()
  expect(openUrl).not.toHaveBeenCalled()
})

it('shares Claude input and output without including cache token fields', async () => {
  const data: ShareUsageCardProps = {
    provider: 'claude',
    range: '30d',
    daily: [],
    summary: {
      scope: 'all',
      range: '30d',
      sessions: 2,
      turns: 3,
      zeroCacheReadTurns: 0,
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 500,
      cacheWriteTokens: 600,
      cacheReuseRate: null,
      estimatedCostUsd: null,
      hasUnpricedModels: true,
      topModel: null,
      topProject: null,
      hasAnyClaudeData: true
    }
  }
  fireEvent.click(await openShare(data))
  await waitFor(() => expect(openUrl).toHaveBeenCalledOnce())
  const text = new URL(openUrl.mock.calls[0][0]).searchParams.get('text')
  expect(text).toBe(buildUsageShareText(data))
  expect(text).toContain('300 tokens')
  expect(text).toContain('n/a')
})
