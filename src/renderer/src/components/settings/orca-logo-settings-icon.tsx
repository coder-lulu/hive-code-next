import { createElement } from 'react'
import { PRODUCT_LOGO_URL as logo } from '@/product-brand'
import { cn } from '@/lib/utils'

export function OrcaLogoSettingsIcon({ className }: { className?: string }): React.JSX.Element {
  return createElement('img', {
    src: logo,
    alt: '',
    'aria-hidden': true,
    className: cn('rounded-sm object-contain', className)
  })
}
