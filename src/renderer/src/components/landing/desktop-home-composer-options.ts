import type { AgentLaunchPermissionMode } from '../../../../shared/tui-agent-permissions'
import { translate } from '@/i18n/i18n'

export type DesktopHomeInlineOption<Value extends string = string> = {
  value: Value
  label: string
  description?: string
  disabled?: boolean
}

export function createDesktopHomeTaskTypeOptions(): DesktopHomeInlineOption[] {
  return [
    {
      value: 'code',
      label: translate('components.desktopHome.composer.taskTypeCode', 'Code development')
    },
    {
      value: 'analysis',
      label: translate('components.desktopHome.composer.taskTypeAnalysis', 'Requirements analysis')
    },
    {
      value: 'architecture',
      label: translate(
        'components.desktopHome.composer.taskTypeArchitecture',
        'Architecture design'
      )
    },
    {
      value: 'review',
      label: translate('components.desktopHome.composer.taskTypeReview', 'Code review')
    },
    {
      value: 'debug',
      label: translate('components.desktopHome.composer.taskTypeDebug', 'Debugging')
    },
    {
      value: 'tests',
      label: translate('components.desktopHome.composer.taskTypeTests', 'Test generation')
    },
    {
      value: 'docs',
      label: translate('components.desktopHome.composer.taskTypeDocs', 'Documentation')
    }
  ]
}

export function createDesktopHomeTaskModeOptions(): DesktopHomeInlineOption[] {
  return [
    {
      value: 'task',
      label: translate('components.desktopHome.composer.taskModeTask', 'Task mode'),
      description: translate(
        'components.desktopHome.composer.taskModeTaskDescription',
        'Create execution steps and carry the task forward'
      )
    },
    {
      value: 'chat',
      label: translate('components.desktopHome.composer.taskModeChat', 'Chat mode'),
      description: translate(
        'components.desktopHome.composer.taskModeChatDescription',
        'Focus on questions, answers, and analysis'
      )
    },
    {
      value: 'plan',
      label: translate('components.desktopHome.composer.taskModePlan', 'Plan mode'),
      description: translate(
        'components.desktopHome.composer.taskModePlanDescription',
        'Create a plan and wait for confirmation'
      )
    },
    {
      value: 'execute',
      label: translate('components.desktopHome.composer.taskModeExecute', 'Execute mode'),
      description: translate(
        'components.desktopHome.composer.taskModeExecuteDescription',
        'Carry out an approved task'
      )
    },
    {
      value: 'review',
      label: translate('components.desktopHome.composer.taskModeReview', 'Review mode'),
      description: translate(
        'components.desktopHome.composer.taskModeReviewDescription',
        'Analyze code, diffs, or results'
      )
    }
  ]
}

export function createDesktopHomeQualityOptions(): DesktopHomeInlineOption[] {
  return [
    {
      value: 'fast',
      label: translate('components.desktopHome.composer.qualityFast', 'Fast'),
      description: translate(
        'components.desktopHome.composer.qualityFastDescription',
        'Best for simple changes and focused tasks'
      )
    },
    {
      value: 'balanced',
      label: translate('components.desktopHome.composer.qualityBalanced', 'Balanced'),
      description: translate(
        'components.desktopHome.composer.qualityBalancedDescription',
        'Balance speed, scope, and result quality'
      )
    },
    {
      value: 'deep',
      label: translate('components.desktopHome.composer.qualityDeep', 'Deep'),
      description: translate(
        'components.desktopHome.composer.qualityDeepDescription',
        'Best for complex analysis and multi-step development'
      )
    }
  ]
}

export function createDesktopHomeContextOptions(): DesktopHomeInlineOption[] {
  return [
    {
      value: 'file',
      label: translate('components.desktopHome.composer.contextFile', 'File')
    },
    {
      value: 'folder',
      label: translate('components.desktopHome.composer.contextFolder', 'Folder')
    },
    {
      value: 'project',
      label: translate('components.desktopHome.composer.contextProject', 'Project')
    },
    {
      value: 'worktree',
      label: translate('components.desktopHome.composer.contextWorktree', 'Worktree')
    },
    {
      value: 'diff',
      label: translate('components.desktopHome.composer.contextDiff', 'Git diff')
    },
    {
      value: 'recent',
      label: translate('components.desktopHome.composer.contextRecentFiles', 'Recent files')
    },
    {
      value: 'terminal',
      label: translate('components.desktopHome.composer.contextTerminal', 'Terminal output')
    },
    {
      value: 'image',
      label: translate('components.desktopHome.composer.contextImage', 'Image')
    },
    {
      value: 'issue',
      label: translate('components.desktopHome.composer.contextIssue', 'Task or issue')
    }
  ]
}

export function createDesktopHomePermissionOptions(
  supported = true
): DesktopHomeInlineOption<AgentLaunchPermissionMode>[] {
  const unsupportedDescription = supported
    ? undefined
    : translate(
        'components.desktopHome.composer.permissionUnsupported',
        'This agent does not expose a supported permission override'
      )
  return [
    {
      value: 'default',
      label: translate('components.desktopHome.composer.permissionDefault', 'Default')
    },
    {
      value: 'manual',
      label: translate('components.desktopHome.composer.permissionAsk', 'Always ask'),
      ...(unsupportedDescription ? { description: unsupportedDescription, disabled: true } : {})
    },
    {
      value: 'yolo',
      label: translate('components.desktopHome.composer.permissionAuto', 'Auto-approve'),
      ...(unsupportedDescription ? { description: unsupportedDescription, disabled: true } : {})
    }
  ]
}
