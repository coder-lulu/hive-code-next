import type { AgentNpmRegistry } from '../../../../shared/agent-npm-registry'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export function AgentNpmRegistrySetting({
  value,
  onChange
}: {
  value: AgentNpmRegistry
  onChange: (registry: AgentNpmRegistry) => void | Promise<void>
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <Label htmlFor="agent-npm-registry">
          {translate('agentsSettings.packageSource', 'Package source')}
        </Label>
        <p className="text-xs text-muted-foreground">
          {translate(
            'agentsSettings.packageSourceHint',
            'Used for npm agent installation, upgrades and latest versions. Mirror updates may arrive later.'
          )}
        </p>
      </div>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next === 'default' || next === 'china') {
            void onChange(next)
          }
        }}
      >
        <SelectTrigger
          id="agent-npm-registry"
          size="sm"
          className="w-52"
          aria-label={translate('agentsSettings.packageSource', 'Package source')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">
            {translate('agentsSettings.packageSourceDefault', 'Default source')}
          </SelectItem>
          <SelectItem value="china">
            {translate('agentsSettings.packageSourceChina', 'China mirror')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
