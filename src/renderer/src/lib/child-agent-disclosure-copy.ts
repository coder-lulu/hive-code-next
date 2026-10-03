import { translate } from '@/i18n/i18n'

export function getChildAgentDisclosureLabel(count: number, expanded: boolean): string {
  if (expanded) {
    return count === 1
      ? translate('components.childAgents.hideOne', 'Hide {{count}} child agent', { count })
      : translate('components.childAgents.hideMany', 'Hide {{count}} child agents', { count })
  }
  return count === 1
    ? translate('components.childAgents.showOne', 'Show {{count}} child agent', { count })
    : translate('components.childAgents.showMany', 'Show {{count}} child agents', { count })
}
