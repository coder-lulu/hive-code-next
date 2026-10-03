import { useEffect } from 'react'

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useDeviceConnectionsPageEscape(onClose: () => void): void {
  // Why: mirror Automations/Tasks — Esc first exits field focus, then closes the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      if (isEditableElement(target)) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      onClose()
    }
    // Why: bubble phase lets Radix popovers/selects consume Escape first.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}
