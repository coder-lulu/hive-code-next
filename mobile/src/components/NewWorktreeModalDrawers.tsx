import { View } from 'react-native'
import { Monitor } from 'lucide-react-native'
import type { SmartModeAvailabilityInput } from '../tasks/mobile-smart-source-modes'
import type { PasteRepoCandidate } from '../tasks/smart-source-paste-intent'
import type { useMobileComposerSource } from '../tasks/use-mobile-composer-source'
import { MobileRuntimeSelector } from '../runtime-directory/MobileRuntimeSelector'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileAgentIcon } from './MobileAgentIcon'
import type { NewWorktreeAgentOption } from './new-worktree-agent-selection'
import { createNewWorktreeModalStyles } from './new-worktree-modal-styles'
import type { MobileWorkspaceRepo, WorkspaceRuntimeSelection } from './new-worktree-modal-types'
import type {
  NewWorkspaceProjectOption,
  NewWorkspaceRunTargetOption
} from './new-workspace-project-targets'
import { getMobileWorkspaceRepoBadgeColor } from './new-worktree-modal-types'
import { PickerListDrawer } from './PickerListDrawer'
import { SetupHookTrustDrawer, type SetupTrustPrompt } from './SetupHookTrustDrawer'
import { SmartWorkspaceSourceDrawer } from './SmartWorkspaceSourceDrawer'
import type { NewWorktreeDrawerView } from './use-new-worktree-drawer-navigation'

type Composer = ReturnType<typeof useMobileComposerSource>

export function NewWorktreeModalDrawers(props: {
  runtimeSelection?: WorkspaceRuntimeSelection
  hostId?: string
  onOpenRuntime: () => void
  onSelectRuntime: (runtimeId: string) => void
  onPairRuntime: () => void
  visible: boolean
  drawerView: NewWorktreeDrawerView
  client: Parameters<typeof SmartWorkspaceSourceDrawer>[0]['client']
  composer: Composer
  sourceAvailability: SmartModeAvailabilityInput
  selectedRepo: MobileWorkspaceRepo | null
  repos: MobileWorkspaceRepo[]
  pasteRepos: PasteRepoCandidate[]
  sshReady: boolean
  projectPickerItems: NewWorkspaceProjectOption<MobileWorkspaceRepo>[]
  selectedProjectId: string | null
  runTargetPickerItems: NewWorkspaceRunTargetOption<MobileWorkspaceRepo>[]
  pickerAgentOptions: NewWorktreeAgentOption[]
  selectedAgent: NewWorktreeAgentOption
  setupTrustPrompt: SetupTrustPrompt | null
  creating: boolean
  onSourceRepoChange: (repo: MobileWorkspaceRepo) => void
  onRepoChange: (repo: MobileWorkspaceRepo) => void
  onAgentChange: (agent: NewWorktreeAgentOption) => void
  onTransitionToForm: () => void
  onApproveSetupTrust: (alwaysTrust: boolean) => void
  onSkipSetupTrust: () => void
  onCloseSetupTrust: () => void
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createNewWorktreeModalStyles)
  const runTargets = [
    ...props.runTargetPickerItems,
    ...(props.runtimeSelection
      ? [
          {
            id: 'switch-runtime',
            label: '切换 Runtime',
            detail: '选择账号中的电脑；切换后重新选择项目',
            repo: null
          }
        ]
      : [])
  ]
  return (
    <>
      <SmartWorkspaceSourceDrawer
        visible={props.visible && props.drawerView === 'source'}
        client={props.client}
        composer={props.composer}
        availability={props.sourceAvailability}
        repoId={props.selectedRepo?.id ?? null}
        repos={props.pasteRepos}
        sshReady={props.sshReady}
        onRepoChange={(repoId) => {
          const nextRepo = props.repos.find((repo) => repo.id === repoId)
          if (nextRepo) {
            props.onSourceRepoChange(nextRepo)
          }
        }}
        onClose={props.onTransitionToForm}
      />

      <PickerListDrawer
        visible={props.visible && props.drawerView === 'project'}
        title="Project"
        items={props.projectPickerItems}
        selectedId={props.selectedProjectId ?? ''}
        onSelect={(item) => props.onRepoChange(item.repo)}
        onClose={props.onTransitionToForm}
        renderIcon={(item) => (
          <View
            style={[
              styles.repoDot,
              { backgroundColor: getMobileWorkspaceRepoBadgeColor(item.repo) }
            ]}
          />
        )}
      />

      <PickerListDrawer
        visible={props.visible && props.drawerView === 'runTarget'}
        title="Run on"
        items={runTargets}
        selectedId={props.selectedRepo?.id ?? ''}
        onSelect={(item) => (item.repo ? props.onRepoChange(item.repo) : props.onOpenRuntime())}
        onClose={props.onTransitionToForm}
        renderIcon={() => <Monitor size={16} color={theme.color.text.secondary} />}
      />

      <PickerListDrawer
        visible={props.visible && props.drawerView === 'agent'}
        title="Agent"
        items={props.pickerAgentOptions}
        selectedId={props.selectedAgent.id}
        onSelect={props.onAgentChange}
        onClose={props.onTransitionToForm}
        renderIcon={(agent) => <MobileAgentIcon agentId={agent.id} size={18} />}
      />

      {props.runtimeSelection ? (
        <MobileRuntimeSelector
          visible={props.visible && props.drawerView === 'runtime'}
          catalog={props.runtimeSelection.catalog}
          connectionStates={props.runtimeSelection.connectionStates}
          selectedId={props.hostId ?? null}
          theme={theme}
          onClose={props.onTransitionToForm}
          onSelect={props.onSelectRuntime}
          onPair={props.onPairRuntime}
        />
      ) : null}

      <SetupHookTrustDrawer
        visible={props.visible && props.drawerView === 'trust' && props.setupTrustPrompt != null}
        prompt={props.setupTrustPrompt}
        busy={props.creating}
        onRunOnce={() => props.onApproveSetupTrust(false)}
        onAlwaysTrust={() => props.onApproveSetupTrust(true)}
        onDontRun={props.onSkipSetupTrust}
        onClose={props.onCloseSetupTrust}
      />
    </>
  )
}
