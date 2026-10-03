import type { MobileUpdateSnapshot } from './mobile-update-service'

export function mobileUpdateLabel(snapshot: MobileUpdateSnapshot): string {
  switch (snapshot.state) {
    case 'idle':
      return '检查是否有新版本'
    case 'checking':
      return '检查中'
    case 'available':
      return `有更新 ${snapshot.version ?? ''}`.trim()
    case 'awaiting-permission':
      return '等待安装权限'
    case 'downloading':
      return `下载中 ${downloadPercent(snapshot)}%`
    case 'opening-installer':
      return '正在打开安装器'
    case 'ready-to-install':
      return '等待完成安装'
    case 'error':
      return '更新失败，点击重试'
    case 'not-available':
      return '已是最新版本'
  }
}

export function downloadPercent(snapshot: MobileUpdateSnapshot): number {
  return snapshot.totalBytes > 0
    ? Math.min(100, Math.floor((snapshot.downloadedBytes / snapshot.totalBytes) * 100))
    : 0
}

export function updateIsBusy(snapshot: MobileUpdateSnapshot): boolean {
  return ['checking', 'downloading', 'opening-installer'].includes(snapshot.state)
}
