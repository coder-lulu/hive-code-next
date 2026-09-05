import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { markSimulatorDeviceBooted } from './emulator-device-state'
import { toSimulatorDeviceRows, type RawEmulatorDevice } from './emulator-device-row-mapping'
import { emulatorPaneErrorMessage } from './emulator-pane-error-message'
import type { SimulatorDeviceRow } from './emulator-pane-types'

type UseEmulatorDeviceListArgs = {
  mountedRef: RefObject<boolean>
  setError: Dispatch<SetStateAction<string | null>>
}

export function useEmulatorDeviceList({ mountedRef, setError }: UseEmulatorDeviceListArgs) {
  const [devices, setDevices] = useState<SimulatorDeviceRow[]>([])
  const refreshErrorRef = useRef<unknown>(null)

  const refreshDevices = useCallback(
    async (bootedTarget?: string | null) => {
      try {
        const raw = (await callRuntimeRpc(
          { kind: 'local' },
          'emulator.listDevices',
          {}
        )) as RawEmulatorDevice[]
        const next = markSimulatorDeviceBooted(toSimulatorDeviceRows(raw), bootedTarget)
        if (!mountedRef.current) {
          return next
        }
        const hadRefreshError = refreshErrorRef.current !== null
        refreshErrorRef.current = null
        setDevices(next)
        if (hadRefreshError) {
          setError(null)
        }
        return next
      } catch (error) {
        refreshErrorRef.current = error
        if (mountedRef.current) {
          setDevices([])
          setError(emulatorPaneErrorMessage(error, 'Could not list emulator devices.'))
        }
        return []
      }
    },
    [mountedRef, setError]
  )

  return { devices, setDevices, refreshDevices, refreshErrorRef }
}
