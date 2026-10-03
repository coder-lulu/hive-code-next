// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentCommandOverrideInput,
  AgentDefaultArgsInput,
  AgentDefaultEnvInput
} from './AgentLaunchDefaultsEditor'
import { AgentSessionSourceHomeInput } from './codex-session-source-home-control'
import { AGENT_DEFAULT_ENV_DRAFT_MAX_BYTES } from './agent-default-env-draft'
import { TooltipProvider } from '../ui/tooltip'

type SaveSpy = (value: string | Record<string, string>) => void
type EditorCase = {
  label: string
  initial: string
  next: string
  saved: string | Record<string, string>
  render: (onSave: SaveSpy) => ReactNode
}

const editors: EditorCase[] = [
  {
    label: 'Command',
    initial: '/custom/claude',
    next: '  /new/claude  ',
    saved: '/new/claude',
    render: (onSave) => (
      <AgentCommandOverrideInput
        defaultCmd="claude"
        cmdOverride="/custom/claude"
        onSaveOverride={onSave}
      />
    )
  },
  {
    label: 'Arguments',
    initial: '--verbose',
    next: '  --model example  ',
    saved: '--model example',
    render: (onSave) => (
      <AgentDefaultArgsInput defaultArgs="--default" argsOverride="--verbose" onSaveArgs={onSave} />
    )
  },
  {
    label: 'Environment',
    initial: 'EXAMPLE=old',
    next: '  EXAMPLE=new FLAG=1  ',
    saved: { EXAMPLE: 'new', FLAG: '1' },
    render: (onSave) => (
      <AgentDefaultEnvInput
        defaultEnv={{ EXAMPLE: 'default' }}
        envOverride={{ EXAMPLE: 'old' }}
        onSaveEnv={onSave}
      />
    )
  },
  {
    label: 'Codex home to import from',
    initial: '/custom/codex',
    next: '  /new/codex  ',
    saved: '/new/codex',
    render: (onSave) => (
      <AgentSessionSourceHomeInput
        runtimeLabel="Ubuntu: ~/.codex"
        value="/custom/codex"
        onSave={onSave}
      />
    )
  }
]

let root: Root
let container: HTMLDivElement

async function mount(element: ReactNode): Promise<HTMLInputElement> {
  await act(async () => {
    root.render(<TooltipProvider>{element}</TooltipProvider>)
  })
  const input = container.querySelector('input')
  if (!input) {
    throw new Error('Expected an editor input')
  }
  return input
}

async function edit(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter) {
      throw new Error('Expected the native input value setter')
    }
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(input: HTMLInputElement, key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    input.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

describe.each(editors)('$label input', (editor) => {
  it('restores the saved value on Escape without committing the draft', async () => {
    const onSave = vi.fn()
    const input = await mount(editor.render(onSave))
    expect(Array.from(input.labels ?? []).map((label) => label.textContent?.trim())).toContain(
      editor.label
    )
    await edit(input, editor.next)

    const escape = await press(input, 'Escape')

    expect(input.value).toBe(editor.initial)
    expect(onSave).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(input)
    expect(escape.defaultPrevented).toBe(true)
  })

  it('commits once on Enter when Enter also blurs the field', async () => {
    const onSave = vi.fn()
    const input = await mount(editor.render(onSave))
    await edit(input, editor.next)

    await press(input, 'Enter')

    expect(onSave).toHaveBeenCalledExactlyOnceWith(editor.saved)
    expect(document.activeElement).not.toBe(input)
  })

  it('commits a normal blur, including after an Escape cancellation', async () => {
    const onSave = vi.fn()
    const input = await mount(editor.render(onSave))
    await edit(input, editor.next)
    await press(input, 'Escape')
    onSave.mockClear()

    await edit(input, editor.next)
    await act(async () => input.blur())

    expect(onSave).toHaveBeenCalledExactlyOnceWith(editor.saved)
  })
})

describe('launch override semantics', () => {
  it.each(['', '  claude  '])('clears a command override for %j', async (draft) => {
    const onSave = vi.fn()
    const input = await mount(editors[0].render(onSave))
    await edit(input, draft)

    await press(input, 'Enter')

    expect(onSave).toHaveBeenCalledExactlyOnceWith('')
    expect(input.value).toBe('claude')
  })

  it('preserves an explicitly empty argument override', async () => {
    const onSave = vi.fn()
    const input = await mount(editors[1].render(onSave))
    await edit(input, '   ')

    await press(input, 'Enter')

    expect(onSave).toHaveBeenCalledExactlyOnceWith('')
  })

  it('keeps an oversized environment draft with its error until Escape restores it', async () => {
    const onSave = vi.fn()
    const input = await mount(editors[2].render(onSave))
    const oversized = `EXAMPLE=${'x'.repeat(AGENT_DEFAULT_ENV_DRAFT_MAX_BYTES)}`
    await edit(input, oversized)

    await press(input, 'Enter')

    expect(onSave).not.toHaveBeenCalled()
    expect(input.value).toBe(oversized)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('Environment text is too large to parse safely.')

    await act(async () => input.focus())
    await press(input, 'Escape')

    expect(input.value).toBe('EXAMPLE=old')
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(onSave).not.toHaveBeenCalled()
  })
})
