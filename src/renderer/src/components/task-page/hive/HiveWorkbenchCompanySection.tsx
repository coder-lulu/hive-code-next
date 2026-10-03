import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { HiveWorkbenchModel } from './use-hive-workbench'
import { HiveWorkbenchPicker } from './HiveWorkbenchPicker'

export function HiveWorkbenchCompanySection({ model }: { model: HiveWorkbenchModel }) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const showForm = creating || (!model.companies.items.length && !model.busy && !model.error)
  return (
    <section
      className="space-y-3 border-b border-border pb-5"
      aria-labelledby="hive-company-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hive-company-heading" className="text-sm font-medium">
          {t('hiveWorkbench.company')}
        </h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={model.busy}
          onClick={() => setCreating(true)}
        >
          <Plus />
          {t('hiveWorkbench.newCompany')}
        </Button>
      </div>
      {model.companies.items.length > 0 && (
        <HiveWorkbenchPicker
          id="hive-company"
          label={t('hiveWorkbench.company')}
          placeholder={t('hiveWorkbench.chooseCompany')}
          items={model.companies.items}
          value={model.companyId}
          disabled={model.busy}
          hasMore={Boolean(model.companies.nextCursor)}
          onLoadMore={() => {
            void model.loadMoreCompanies()
          }}
          onValueChange={model.selectCompany}
        />
      )}
      {showForm && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void model.createCompany({ name }).then((success) => {
              if (success) {
                setName('')
                setCreating(false)
              }
            })
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="hive-company-name">{t('hiveWorkbench.companyName')}</Label>
            <Input
              id="hive-company-name"
              value={name}
              required
              maxLength={160}
              disabled={model.busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {model.companies.items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={model.busy}
                onClick={() => setCreating(false)}
              >
                {t('hiveWorkbench.dismiss')}
              </Button>
            )}
            <Button type="submit" disabled={model.busy || !name.trim()}>
              {t('hiveWorkbench.createCompany')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
