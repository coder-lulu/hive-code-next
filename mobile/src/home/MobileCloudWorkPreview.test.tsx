import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import type { RpcClient } from '../transport/rpc-client'
import { MobileCloudWorkPreview } from './MobileCloudWorkPreview'

const viewport = vi.hoisted(() => ({ width: 390 }))
const probe = vi.hoisted(() => ({ callback: null as null | ((capabilities: string[]) => void) }))
const agentLoader = vi.hoisted(() => ({ load: vi.fn() }))
const terminalCreate = vi.hoisted(() => ({ create: vi.fn(), mutationId: vi.fn() }))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  TextInput: 'TextInput',
  useWindowDimensions: () => ({ width: viewport.width, height: 844 }),
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  Bot: 'Bot',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  CircleCheckBig: 'CircleCheckBig',
  Code2: 'Code2',
  FileText: 'FileText',
  FolderKanban: 'FolderKanban',
  ImagePlus: 'ImagePlus',
  ListTodo: 'ListTodo',
  Mic: 'Mic',
  Plus: 'Plus',
  SearchCode: 'SearchCode',
  Sparkles: 'Sparkles',
  Wrench: 'Wrench'
}))

vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { children?: ReactNode }) => props.children
}))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./MobileHomeResumeCard', () => ({ MobileHomeResumeCard: 'MobileHomeResumeCard' }))
vi.mock('./mobile-home-assets', () => ({ GRAPHITE_MASCOT: 'graphite-mascot' }))
vi.mock('../transport/runtime-capability-probe', () => ({
  startRuntimeCapabilityProbe: (_client: unknown, callback: (capabilities: string[]) => void) => {
    probe.callback = callback
    return vi.fn()
  }
}))
vi.mock('../session/mobile-new-tab-agent-loader', () => ({
  loadMobileNewTabAgentOptions: agentLoader.load
}))
vi.mock('./mobile-home-agent-terminal', () => ({
  createMobileHomeAgentTerminal: terminalCreate.create,
  createMobileHomeAgentTerminalMutationId: terminalCreate.mutationId
}))

const client = { sendRequest: vi.fn() } as unknown as RpcClient

function renderPreview(overrides: Partial<Parameters<typeof MobileCloudWorkPreview>[0]> = {}) {
  const props = {
    client,
    connectionState: 'connected' as const,
    onTerminalCreated: vi.fn(),
    runtimeId: 'runtime-1',
    theme: lightTheme,
    ...overrides
  }
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(MobileCloudWorkPreview, props))
  })
  return { props, renderer: renderer! }
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.findByProps({ accessibilityLabel: label })
}

async function makeComposerReady(): Promise<void> {
  await act(async () => {
    probe.callback?.(['terminal.quick-commands.v1'])
    await Promise.resolve()
  })
}

describe('MobileCloudWorkPreview', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    viewport.width = 390
    probe.callback = null
    agentLoader.load.mockReset()
    terminalCreate.create.mockReset()
    terminalCreate.mutationId.mockReset()
  })

  it('creates a real agent terminal only after the Runtime capability and agent are ready', async () => {
    agentLoader.load.mockResolvedValue([{ agent: 'codex', label: 'Codex' }])
    terminalCreate.mutationId.mockReturnValue('submit-1')
    terminalCreate.create.mockResolvedValue({ tab: { id: 'tab-1' } })
    const rendered = renderPreview()
    renderer = rendered.renderer

    act(() => button(renderer, '云端工作任务').props.onChangeText('分析当前工作区的代码结构与风险'))
    expect(button(renderer, '发送任务').props.disabled).toBe(true)
    await makeComposerReady()
    expect(button(renderer, '发送任务').props.disabled).toBe(false)

    await act(async () => button(renderer!, '发送任务').props.onPress())
    expect(terminalCreate.create).toHaveBeenCalledWith({
      agent: 'codex',
      client,
      clientMutationId: 'submit-1',
      prompt: '分析当前工作区的代码结构与风险'
    })
    expect(rendered.props.onTerminalCreated).toHaveBeenCalledWith('runtime-1')
    expect(renderer.root.findByProps({ accessibilityLabel: '云端工作任务' }).props.value).toBe('')
  })

  it('keeps the draft and allows a stable-id retry after a create failure', async () => {
    agentLoader.load.mockResolvedValue([{ agent: 'codex', label: 'Codex' }])
    terminalCreate.mutationId.mockReturnValue('stable-submit')
    terminalCreate.create.mockRejectedValue(new Error('connection lost'))
    const rendered = renderPreview()
    renderer = rendered.renderer
    act(() => button(renderer, '云端工作任务').props.onChangeText('定位并修复当前工作区的问题'))
    await makeComposerReady()

    await act(async () => button(renderer!, '发送任务').props.onPress())
    await act(async () => button(renderer!, '发送任务').props.onPress())

    expect(terminalCreate.mutationId).toHaveBeenCalledOnce()
    expect(terminalCreate.create).toHaveBeenCalledTimes(2)
    expect(renderer.root.findByProps({ accessibilityLabel: '云端工作任务' }).props.value).toBe(
      '定位并修复当前工作区的问题'
    )
    expect(rendered.props.onTerminalCreated).not.toHaveBeenCalled()
  })

  it('marks unsupported composer affordances disabled and omits removed shortcuts', () => {
    const rendered = renderPreview({ client: null, connectionState: 'disconnected' })
    renderer = rendered.renderer

    expect(button(renderer, '添加图片').props.disabled).toBe(true)
    expect(button(renderer, '语音输入').props.disabled).toBe(true)
    expect(button(renderer, '选择代码').props.disabled).toBe(true)
    expect(renderer.root.findAllByProps({ accessibilityLabel: '分析代码' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Runtime 快捷入口' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ children: '继续上次工作' })).toHaveLength(0)
    expect(terminalCreate.create).not.toHaveBeenCalled()
  })
})
