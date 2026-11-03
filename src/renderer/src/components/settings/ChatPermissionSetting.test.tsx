// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { ChatPermissionSetting } from './ChatPermissionSetting'
import { TooltipProvider } from '../ui/tooltip'

vi.mock('../../store', () => ({
  useAppStore: (selector: (value: { settingsSearchQuery: string }) => unknown) =>
    selector({ settingsSearchQuery: '' })
}))
afterEach(cleanup)

it.each([undefined, 'own', 'ask', 'full-access'] as const)(
  'offers the current profile default %s', mode => {
    render(<TooltipProvider><ChatPermissionSetting settings={{...getDefaultSettings('/tmp'),agentPermissionDefault:mode}} updateSettings={vi.fn()} forceVisible /></TooltipProvider>)
    const label = mode === 'ask' ? 'Ask for approval' : mode === 'full-access' ? 'Full access' : 'Own settings'
    expect(screen.getByRole('button',{name:`Permissions ${label}`})).toBeTruthy()
  }
)
it('changes the profile default while preserving per-agent choices and literal configuration', () => {
  const updateSettings = vi.fn()
  const settings = {...getDefaultSettings('/tmp'),agentPermissionDefault:'ask' as const,agentPermissionOverrides:{claude:'own' as const,codex:'ask' as const},agentDefaultArgs:{claude:'--literal'},agentDefaultEnv:{goose:{GOOSE_MODE:'auto'}}}
  const element = ChatPermissionSetting({settings,updateSettings,forceVisible:true})!
  element.props.children.props.control.props.onSelect('full-access')
  expect(updateSettings).toHaveBeenCalledWith({agentPermissionDefault:'full-access',agentPermissionOverrides:{claude:'own',codex:'ask'}})
  element.props.children.props.control.props.onSelect('own')
  expect(updateSettings).toHaveBeenLastCalledWith({agentPermissionDefault:'own',agentPermissionOverrides:{claude:'own',codex:'ask'}})
})
