import { useEffect, useRef } from 'react'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { HiveMobilePushRegistrationCoordinator } from './hive-mobile-push-registration'

export function HiveMobilePushRegistrationObserver(): null {
  const { session } = useMobileAuthSession()
  const coordinatorRef = useRef<HiveMobilePushRegistrationCoordinator | null>(null)
  if (!coordinatorRef.current) {
    coordinatorRef.current = new HiveMobilePushRegistrationCoordinator()
  }

  useEffect(() => {
    const coordinator = coordinatorRef.current!
    coordinator.start()
    return () => coordinator.stop()
  }, [])

  useEffect(() => {
    coordinatorRef.current?.setSession(session)
  }, [session])

  return null
}
