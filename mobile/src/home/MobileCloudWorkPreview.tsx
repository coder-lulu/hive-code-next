import { useEffect, useRef, useState } from 'react'
import type { TextInput } from 'react-native'
import { MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../src/shared/terminal-quick-commands'
import { FLOATING_WORKSPACE_WORKTREE_ID } from '../session/floating-workspace'
import { loadMobileNewTabAgentOptions } from '../session/mobile-new-tab-agent-loader'
import type { MobileNewTabAgentOption } from '../session/mobile-new-tab-agent-options'
import { supportsMobileQuickCommands } from '../terminal/quick-commands'
import type { MobileTheme } from '../theme/mobile-theme'
import { startRuntimeCapabilityProbe } from '../transport/runtime-capability-probe'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { MobileCloudWorkPreviewView } from './mobile-cloud-work-preview-view'
import {
  createMobileHomeAgentTerminal,
  createMobileHomeAgentTerminalMutationId
} from './mobile-home-agent-terminal'

interface MobileCloudWorkPreviewProps {
  readonly client: RpcClient | null
  readonly connectionState: ConnectionState
  readonly theme: MobileTheme
  readonly runtimeId: string | null
  readonly onTerminalCreated: (runtimeId: string) => void
}

type ComposerAvailability =
  | 'disconnected'
  | 'checking'
  | 'loading-agents'
  | 'ready'
  | 'unsupported'
  | 'no-agents'
  | 'error'

export function MobileCloudWorkPreview({
  client,
  connectionState,
  onTerminalCreated,
  runtimeId,
  theme
}: MobileCloudWorkPreviewProps) {
  const inputRef = useRef<TextInput>(null)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const retryRef = useRef<{ fingerprint: string; clientMutationId: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [availability, setAvailability] = useState<ComposerAvailability>('disconnected')
  const [agentOptions, setAgentOptions] = useState<MobileNewTabAgentOption[]>([])
  const [selectedAgent, setSelectedAgent] = useState<MobileNewTabAgentOption['agent'] | null>(null)
  const [agentPickerVisible, setAgentPickerVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    let loadingAgents = false
    setAgentOptions([])
    setSelectedAgent(null)
    setAgentPickerVisible(false)
    setSubmitError(null)
    if (!client || !runtimeId || connectionState !== 'connected') {
      setAvailability('disconnected')
      return () => {
        active = false
      }
    }

    setAvailability('checking')
    const cancelProbe = startRuntimeCapabilityProbe(client, (capabilities) => {
      if (!active || loadingAgents) {
        return
      }
      if (!supportsMobileQuickCommands(capabilities)) {
        setAvailability('unsupported')
        return
      }
      loadingAgents = true
      setAvailability('loading-agents')
      void loadMobileNewTabAgentOptions({
        client,
        worktreeId: FLOATING_WORKSPACE_WORKTREE_ID
      }).then(
        (options) => {
          if (!active) {
            return
          }
          setAgentOptions(options)
          setSelectedAgent(options[0]?.agent ?? null)
          setAvailability(options.length > 0 ? 'ready' : 'no-agents')
        },
        () => {
          if (active) {
            setAvailability('error')
          }
        }
      )
    })
    return () => {
      active = false
      cancelProbe()
    }
  }, [client, connectionState, runtimeId])

  async function submitDraft(): Promise<void> {
    const prompt = draft.trim()
    const agent = selectedAgent
    if (
      submittingRef.current ||
      !client ||
      !runtimeId ||
      connectionState !== 'connected' ||
      availability !== 'ready' ||
      !agent ||
      !prompt ||
      prompt.length > MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
    ) {
      return
    }

    const capturedClient = client
    const capturedRuntimeId = runtimeId
    const fingerprint = `${capturedRuntimeId}\u0000${agent}\u0000${prompt}`
    const clientMutationId =
      retryRef.current?.fingerprint === fingerprint
        ? retryRef.current.clientMutationId
        : createMobileHomeAgentTerminalMutationId()
    retryRef.current = { fingerprint, clientMutationId }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createMobileHomeAgentTerminal({
        agent,
        client: capturedClient,
        clientMutationId,
        prompt
      })
      if (!mountedRef.current) {
        return
      }
      retryRef.current = null
      setDraft('')
      onTerminalCreated(capturedRuntimeId)
    } catch (error) {
      if (mountedRef.current) {
        setSubmitError(
          error instanceof Error ? `无法启动任务：${error.message}` : '无法启动任务，请重试。'
        )
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const availabilityNotice = composerAvailabilityNotice(availability)
  const notice =
    submitError ??
    (availability === 'unsupported' || availability === 'no-agents' || availability === 'error'
      ? availabilityNotice
      : null)
  const composerFootnote =
    notice == null && availabilityNotice ? availabilityNotice : '内容由 AI 生成，请核对关键结果'
  const canSubmit =
    availability === 'ready' &&
    connectionState === 'connected' &&
    !!client &&
    !!runtimeId &&
    !!selectedAgent &&
    !!draft.trim() &&
    draft.trim().length <= MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH &&
    !submitting

  return (
    <MobileCloudWorkPreviewView
      agentOptions={agentOptions}
      agentPickerVisible={agentPickerVisible}
      canPickAgent={availability === 'ready' && !submitting}
      canSubmit={canSubmit}
      composerFootnote={composerFootnote}
      draft={draft}
      focused={focused}
      inputRef={inputRef}
      notice={notice}
      onAgentPickerClose={() => setAgentPickerVisible(false)}
      onAgentPickerOpen={() => setAgentPickerVisible(true)}
      onDraftChange={(value) => {
        setDraft(value)
        setSubmitError(null)
      }}
      onInputBlur={() => setFocused(false)}
      onInputFocus={() => {
        setFocused(true)
        setSubmitError(null)
      }}
      onSelectAgent={(agent) => {
        setSelectedAgent(agent)
        setAgentPickerVisible(false)
        setSubmitError(null)
      }}
      onSubmit={submitDraft}
      selectedAgent={selectedAgent}
      submitting={submitting}
      theme={theme}
    />
  )
}

function composerAvailabilityNotice(availability: ComposerAvailability): string | null {
  if (availability === 'disconnected') {
    return '连接 Runtime 后即可从首页启动任务。'
  }
  if (availability === 'checking') {
    return '正在检查 Runtime 的任务能力…'
  }
  if (availability === 'loading-agents') {
    return '正在读取 Runtime 上可用的智能体…'
  }
  if (availability === 'unsupported') {
    return '当前 Runtime 版本不支持从首页启动任务，请更新桌面端。'
  }
  if (availability === 'no-agents') {
    return '当前 Runtime 没有检测到可用的智能体。'
  }
  if (availability === 'error') {
    return '无法读取 Runtime 的智能体，请检查连接后重试。'
  }
  return null
}
