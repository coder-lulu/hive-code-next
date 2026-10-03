import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

export function HiveWorkbenchPicker({
  id,
  label,
  placeholder,
  items,
  value,
  disabled,
  hasMore,
  onLoadMore,
  onValueChange
}: {
  id: string
  label: string
  placeholder: string
  items: { id: string; name: string }[]
  value: string | null
  disabled: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  onValueChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const selected = items.find((item) => item.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          className="w-full min-w-0 justify-between"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)]">
        <Command>
          <CommandInput
            aria-label={t('hiveWorkbench.search')}
            placeholder={t('hiveWorkbench.search')}
          />
          <CommandList className="max-h-72">
            <CommandEmpty>{t('hiveWorkbench.noMatches')}</CommandEmpty>
            {items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                keywords={[item.name]}
                disabled={disabled}
                onSelect={() => {
                  onValueChange(item.id)
                  setOpen(false)
                }}
              >
                <Check className={cn('size-4', value === item.id ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{item.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {hasMore && (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              className="w-full"
              onClick={onLoadMore}
            >
              {t('hiveWorkbench.loadMore')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
