import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadHostCatalog } from '../transport/host-store'
import type { HostCatalogEntry } from '../transport/types'
import { useAccountRuntimeDirectory } from './account-runtime-directory-provider'

type AccountVisibleHostCatalogState = {
  catalog: HostCatalogEntry[]
  loaded: boolean
  error: string | null
}

type LocalHostCatalogState = {
  localCatalog: HostCatalogEntry[]
  loaded: boolean
  error: string | null
}

export function useAccountVisibleHostCatalog(): AccountVisibleHostCatalogState & {
  reload: () => Promise<HostCatalogEntry[]>
} {
  const { mergeCatalog } = useAccountRuntimeDirectory()
  const mergeCatalogRef = useRef(mergeCatalog)
  const loadGenerationRef = useRef(0)
  const [state, setState] = useState<LocalHostCatalogState>({
    localCatalog: [],
    loaded: false,
    error: null
  })
  mergeCatalogRef.current = mergeCatalog
  const catalog = useMemo(
    () => mergeCatalog(state.localCatalog),
    [mergeCatalog, state.localCatalog]
  )

  const reload = useCallback(async (): Promise<HostCatalogEntry[]> => {
    const generation = ++loadGenerationRef.current
    try {
      const localCatalog = await loadHostCatalog()
      if (generation !== loadGenerationRef.current) {
        return []
      }
      const catalog = mergeCatalogRef.current(localCatalog)
      setState({ localCatalog, loaded: true, error: null })
      return catalog
    } catch (failure) {
      if (generation !== loadGenerationRef.current) {
        return []
      }
      setState((current) => ({
        ...current,
        loaded: true,
        error: failure instanceof Error ? failure.message : String(failure)
      }))
      throw failure
    }
  }, [])

  useEffect(() => {
    void reload().catch(() => undefined)
    return () => {
      loadGenerationRef.current += 1
    }
  }, [reload])

  return { catalog, loaded: state.loaded, error: state.error, reload }
}
