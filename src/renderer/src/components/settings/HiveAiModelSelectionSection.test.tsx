// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { HiveAccountState } from '../../../../shared/hive-account'
import type { HiveAiModelSelection } from '../../../../shared/hive-ai-model-catalog'
import { accountModelCatalogFixture as catalog } from '../../../../shared/hive-ai-model-catalog.test-fixture'
import { HiveAiModelSelectionSection } from './HiveAiModelSelectionSection'

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
function fixture() {
  let owner = 'owner-a'
  let selection: HiveAiModelSelection | null = null
  let changed = (_state: HiveAccountState) => {}
  const view = () => ({ accountId: owner, catalog, selection })
  const read = vi.fn(async () => view())
  const select = vi.fn(async (command: HiveAiModelSelection) => {
    selection = command
    return view()
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      hiveAccount: {
        readAiModels: read,
        selectAiModel: select,
        onStateChanged: (notify: typeof changed) => {
          changed = notify
          return () => {}
        }
      }
    }
  })
  return {
    read,
    select,
    clearSelection: () => {
      selection = null
    },
    owner: (next: string) => {
      owner = next
      selection = null
    },
    changed: (
      state: HiveAccountState = { configured: true, status: 'signed-out', persistence: 'none' }
    ) => changed(state)
  }
}
it('has no default choice and offers only declared protocols with model search', async () => {
  const { select } = fixture()
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  await screen.findByRole('button', { name: 'Choose model-b Responses' })
  expect(screen.getByText('No model selected.')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Choose vendor/model-a Responses' })
  ).not.toBeInTheDocument()
  expect(select).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'VENDOR/' } })
  expect(screen.getByText('vendor/model-a')).toBeVisible()
  expect(screen.queryByText('model-b')).not.toBeInTheDocument()
})
it('confirms an explicit selection through a fresh read and sends no identity or secret', async () => {
  const { read, select } = fixture()
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose model-b Responses' }))
  expect(await screen.findByText('Selected: model-b · Responses')).toBeVisible()
  expect(select).toHaveBeenCalledWith({
    modelId: 'model-b',
    protocol: 'RESPONSES',
    snapshotRevision: catalog.snapshotRevision
  })
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Choose model-b Responses' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})
it('blocks repeated choices immediately while awaiting the selection', async () => {
  const { select } = fixture()
  let release!: (value: Awaited<ReturnType<typeof select>>) => void
  select.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    })
  )
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  const choice = await screen.findByRole('button', { name: 'Choose model-b Responses' })
  fireEvent.click(choice)
  fireEvent.click(choice)
  expect(select).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Refresh models' })).toBeDisabled()
  await act(async () => release({ accountId: 'owner-a', catalog, selection: null }))
})
it('keeps selection failure explicit without reflecting upstream secrets', async () => {
  const { select } = fixture()
  select.mockRejectedValueOnce(new Error('SECRET_CANARY'))
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose model-b Responses' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The selection was not confirmed.')
  expect(screen.queryByText(/SECRET_CANARY/)).not.toBeInTheDocument()
})
it('isolates an old selection result after account change', async () => {
  const { owner, select, read } = fixture()
  let release!: (value: Awaited<ReturnType<typeof select>>) => void
  select.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    })
  )
  const rendered = render(<HiveAiModelSelectionSection accountId="owner-a" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose model-b Responses' }))
  owner('owner-b')
  rendered.rerender(<HiveAiModelSelectionSection accountId="owner-b" />)
  await screen.findByText('No model selected.')
  await act(async () =>
    release({
      accountId: 'owner-a',
      catalog,
      selection: {
        modelId: 'model-b',
        protocol: 'RESPONSES',
        snapshotRevision: catalog.snapshotRevision
      }
    })
  )
  expect(read).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument()
})
it('reconciles a rejected second choice instead of displaying the previous cleared preference', async () => {
  const { read, select, clearSelection } = fixture()
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Choose vendor/model-a Chat Completions' })
  )
  await screen.findByText('Selected: vendor/model-a · Chat Completions')
  select.mockImplementationOnce(async () => {
    clearSelection()
    throw new Error('SECRET_CANARY')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Choose model-b Responses' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The selection was not confirmed.')
  expect(read).toHaveBeenCalledTimes(3)
  expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Choose vendor/model-a Chat Completions' })
  ).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByText(/SECRET_CANARY/)).not.toBeInTheDocument()
})
it('keeps logged-out and hidden states fenced from late choices or manual refresh', async () => {
  const { changed, select, read } = fixture()
  let release!: (value: Awaited<ReturnType<typeof select>>) => void
  select.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve
    })
  )
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Choose model-b Responses' }))
  await act(async () => changed())
  await act(async () => release({ accountId: 'owner-a', catalog, selection: null }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))
  expect(read).toHaveBeenCalledOnce()
  expect(screen.queryByRole('button', { name: 'Choose model-b Responses' })).not.toBeInTheDocument()
})
it('shows an authoritative empty range without reference-model fallback', async () => {
  const { read } = fixture()
  read.mockResolvedValueOnce({
    accountId: 'owner-a',
    catalog: { ...catalog, models: [] },
    selection: null
  })
  render(<HiveAiModelSelectionSection accountId="owner-a" />)
  expect(await screen.findByText('No text models are available to this account.')).toBeVisible()
})
