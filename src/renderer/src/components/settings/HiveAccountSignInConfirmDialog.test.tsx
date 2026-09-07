// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveAccountSmsChallenge } from '../../../../shared/hive-account'

vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
}))

import { HiveAccountSignInConfirmDialog } from './HiveAccountSignInConfirmDialog'

const challenge: HiveAccountSmsChallenge = {
  challengeId: 'first-challenge',
  expiresInSeconds: 300,
  resendAfterSeconds: 60
}

function setup(onSmsStart = vi.fn().mockResolvedValue(challenge)) {
  const props = {
    open: true,
    signingIn: false,
    onOpenChange: vi.fn(),
    onConfirm: vi.fn(),
    onSmsStart,
    onSmsComplete: vi.fn().mockResolvedValue(undefined)
  }
  return { ...render(<HiveAccountSignInConfirmDialog {...props} />), props }
}

async function requestCode(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '13800138000' } })
  fireEvent.click(screen.getByRole('checkbox'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Get code' })))
}

describe('desktop SMS sign-in resend', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T00:00:00Z'))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('counts down the resend cooldown, then sends a new challenge and clears the old code', async () => {
    const { props } = setup()
    await requestCode()
    expect(screen.getByText('Resend in 60s')).toBeInTheDocument()
    expect(screen.queryByText('Resend in 300s')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend code' })).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Resend in 59s')).toBeInTheDocument()
    expect(props.onSmsStart).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } })

    act(() => vi.advanceTimersByTime(59_000))
    expect(screen.queryByText(/Resend in/)).not.toBeInTheDocument()
    expect(props.onSmsStart).toHaveBeenCalledTimes(1)
    props.onSmsStart.mockResolvedValueOnce({ ...challenge, challengeId: 'replacement-challenge' })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resend code' })))
    expect(props.onSmsStart).toHaveBeenCalledTimes(2)
    expect(props.onSmsStart).toHaveBeenLastCalledWith('13800138000', 'TRUSTED')
    expect(screen.getByLabelText('Verification code')).toHaveValue('')
    expect(screen.getByText('Resend in 60s')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '654321' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(props.onSmsComplete).toHaveBeenCalledWith('replacement-challenge', '654321')
  })

  it('uses elapsed wall time after the renderer timer is delayed', async () => {
    setup()
    await requestCode()
    vi.setSystemTime(Date.now() + 65_000)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText(/Resend in/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled()
  })

  it('discards a pending response when the dialog closes and resets the next attempt', async () => {
    let resolveChallenge!: (value: HiveAccountSmsChallenge) => void
    const onSmsStart = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<HiveAccountSmsChallenge>((resolve) => {
            resolveChallenge = resolve
          })
      )
      .mockResolvedValue(challenge)
    const { props, rerender } = setup(onSmsStart)
    await requestCode()
    rerender(<HiveAccountSignInConfirmDialog {...props} open={false} />)
    await act(async () => resolveChallenge(challenge))
    act(() => vi.advanceTimersByTime(60_000))
    rerender(<HiveAccountSignInConfirmDialog {...props} />)
    expect(screen.getByLabelText('Phone number')).toHaveValue('')
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get code' })).toBeEnabled()
    await requestCode()
    expect(screen.getByText('Resend in 60s')).toBeInTheDocument()
  })
})
