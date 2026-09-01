import { app, BrowserWindow, nativeImage } from 'electron'

let unreadCount = 0

function getBadgeLabel(): string {
  return unreadCount === 0 ? '' : unreadCount > 99 ? '99+' : String(unreadCount)
}

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&apos;'
    }
  })
}

function createTaskbarBadgeImage(label: string) {
  if (!label) {
    return null
  }

  // Windows taskbar overlays are small (normally 16px). Rendering the label
  // into an SVG keeps the badge crisp on high-DPI displays without adding an
  // image asset or another native dependency.
  const fontSize = label.length > 2 ? 7 : 10
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="#E5484D"/><text x="8" y="8.5" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeSvgText(label)}</text></svg>`
  try {
    return nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
    )
  } catch {
    // Native overlays are best-effort chrome and must never affect app use.
    return null
  }
}

function applyNativeBadge(): void {
  const label = getBadgeLabel()

  if (process.platform === 'darwin') {
    app.dock?.setBadge(label)
    return
  }

  if (process.platform !== 'win32') {
    return
  }

  const overlay = createTaskbarBadgeImage(label)
  const description = label ? `${label} unread completed tasks` : ''
  for (const window of BrowserWindow?.getAllWindows?.() ?? []) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.setOverlayIcon(overlay, description)
    } catch {
      // A window can disappear between enumeration and overlay assignment.
    }
  }
}

export function setUnreadDockBadgeCount(count: number): void {
  unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0

  applyNativeBadge()
}
