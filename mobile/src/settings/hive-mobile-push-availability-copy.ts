import type { HiveMobilePushAvailability } from '../notifications/hive-mobile-push-availability'
import { APP_DISPLAY_NAME } from '../product-brand'

export function hiveMobilePushAvailabilityCopy(availability: HiveMobilePushAvailability): {
  status: string
  detail: string | null
  unavailable: boolean
} {
  if (availability.status === 'available') {
    return { status: '已开启 · 离线推送可用', detail: null, unavailable: false }
  }
  if (availability.status === 'syncing') {
    return {
      status: '已开启 · 正在连接',
      detail: '系统通知已开启，正在连接 HiveCloud 离线推送服务。',
      unavailable: false
    }
  }
  if (availability.reason === 'not_authenticated') {
    return {
      status: '已开启 · 待登录',
      detail: `系统通知已开启；登录 ${APP_DISPLAY_NAME} 账号后才能接收 HiveCloud 离线推送。`,
      unavailable: true
    }
  }
  if (availability.reason === 'token_unavailable') {
    return {
      status: '已开启 · 离线推送不可用',
      detail: '系统通知已开启，但此构建未取得 Firebase/APNs 原生推送令牌。',
      unavailable: true
    }
  }
  if (availability.reason === 'cloud_unavailable') {
    return {
      status: '已开启 · 离线推送不可用',
      detail: '系统通知已开启，但 HiveCloud 离线推送暂不可用。',
      unavailable: true
    }
  }
  return { status: '已开启', detail: null, unavailable: false }
}
