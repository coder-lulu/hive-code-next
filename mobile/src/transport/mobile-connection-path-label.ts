import { productNameText } from '@/product-brand'
import type { MobileConnectionPath } from './stable-logical-rpc-client'

export function mobileConnectionPathLabel(path: MobileConnectionPath): string {
  if (path === 'relay') {
    return productNameText('Orca Relay')
  }
  return path === 'tailscale' ? 'Direct · Tailscale' : 'Direct · LAN'
}
