import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HiveWorkbenchTeam } from '../../../../../shared/hive-team-workbench'
import type { HiveWorkbenchModel } from './use-hive-workbench'

const roles = ['product', 'developer', 'tester', 'ops'] as const
export function HiveWorkbenchTeamSection({
  model,
  team
}: {
  model: HiveWorkbenchModel
  team: HiveWorkbenchTeam
}) {
  const { t } = useTranslation()
  const [employees, setEmployees] = useState(() =>
    roles.map((role) => ({
      role,
      name:
        team.employees.find((employee) => employee.binding.role === role)?.name ??
        t(`hiveWorkbench.defaultNames.${role}`),
      profileRef: 'codex' as const,
      profileRevision: 'codex:1' as const
    }))
  )
  return (
    <section className="space-y-3" aria-labelledby="hive-team-heading">
      <div className="space-y-1">
        <h2 id="hive-team-heading" className="text-sm font-medium">
          {t('hiveWorkbench.team')}
        </h2>
        <p className="text-xs text-muted-foreground">{t('hiveWorkbench.teamHelp')}</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void model
            .configureTeam({
              projectId: team.project.id,
              expectedRevision: team.project.binding.bindingRevision,
              employees
            })
            .then((success) => {
              if (success) {
                toast.success(t('hiveWorkbench.teamSaved'))
              }
            })
        }}
      >
        <div className="divide-y divide-border">
          {employees.map((employee) => (
            <div key={employee.role} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor={`hive-employee-${employee.role}`}>
                  {t(`hiveWorkbench.roles.${employee.role}`)}
                </Label>
                <span className="text-xs text-muted-foreground">Codex</span>
              </div>
              <Input
                id={`hive-employee-${employee.role}`}
                value={employee.name}
                required
                maxLength={160}
                disabled={model.busy}
                onChange={(event) => {
                  const name = event.target.value
                  setEmployees((previous) =>
                    previous.map((item) => (item.role === employee.role ? { ...item, name } : item))
                  )
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={model.busy || employees.some((employee) => !employee.name.trim())}
          >
            {t('hiveWorkbench.saveTeam')}
          </Button>
        </div>
      </form>
      <p
        role="status"
        className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground"
      >
        {t(
          team.executionAvailability.reason === 'TEAM_NOT_CONFIGURED'
            ? 'hiveWorkbench.teamNotConfigured'
            : 'hiveWorkbench.executionUnavailable'
        )}
      </p>
    </section>
  )
}
