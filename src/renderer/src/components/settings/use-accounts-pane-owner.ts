import { useRef } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { getProviderAccountsOwnerKey } from '@/runtime/runtime-provider-accounts-client'

export function useAccountsPaneOwner(accountOwner: RuntimeClientTarget) {
  const providerAccountOwnerKey = getProviderAccountsOwnerKey(accountOwner)
  const currentOwnerKeyRef = useRef(providerAccountOwnerKey)
  currentOwnerKeyRef.current = providerAccountOwnerKey
  return {
    providerAccountOwnerKey,
    isCurrentAccountOwner: () => currentOwnerKeyRef.current === providerAccountOwnerKey
  }
}
