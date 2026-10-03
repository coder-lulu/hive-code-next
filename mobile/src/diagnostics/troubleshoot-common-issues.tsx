import { productNameText } from '@/product-brand'
import type { LucideIcon } from 'lucide-react-native'
import { WifiOff, Shield, Monitor, Clock, Globe, Bell } from 'lucide-react-native'

export type TroubleshootSection = {
  id: string
  icon: LucideIcon
  title: string
  steps: string[]
}

export const troubleshootCommonIssues: TroubleshootSection[] = [
  {
    id: 'notifications',
    icon: Bell,
    title: '通知',
    steps: [
      '检查系统是否允许 HiveCode 通知，并确认专注模式或勿扰模式已关闭。',
      '尝试切换 Wi-Fi 网络。如果切换后收到通知，当前网络可能延迟了电脑连接。'
    ]
  },

  {
    id: 'wifi',
    icon: WifiOff,
    title: '设备不在同一网络',
    steps: [
      '除使用 Tailscale 外，手机与电脑必须位于同一局域网。',
      '有线网络与 Wi-Fi 需要位于同一子网。',
      '尝试在两台设备上重新连接 Wi-Fi。'
    ]
  },
  {
    id: 'firewall',
    icon: Shield,
    title: '防火墙阻止 6768 端口',
    steps: [
      productNameText('macOS：系统设置 → 网络 → 防火墙，允许 Orca。'),
      productNameText('Windows：Defender 防火墙 → 允许应用，在专用网络中启用 Orca。'),
      'Linux: sudo ufw allow 6768',
      '公司或学校网络可能阻止点对点连接，可尝试个人热点。'
    ]
  },
  {
    id: 'desktop',
    icon: Monitor,
    title: '电脑端应用未运行',
    steps: [
      productNameText('电脑上必须打开 Orca 才能接收连接。'),
      productNameText('尝试重启 Orca，配套服务会在应用启动时运行。'),
      '更新后可能需要重新扫描二维码配对。'
    ]
  },
  {
    id: 'timeout',
    icon: Clock,
    title: '连接超时',
    steps: [
      '检查手机的 Wi-Fi 信号强度。',
      '返回电脑列表并点按目标电脑重试。',
      '如果持续超时，请重启手机端和电脑端应用。'
    ]
  },
  {
    id: 'tailscale',
    icon: Globe,
    title: '无法访问 Tailscale 电脑',
    steps: [
      '100.x.x.x 或 *.ts.net 地址通过 Tailscale 连接，请保持 Tailscale 开启。',
      'iOS 或 Android 的隧道可能卡住，可在 Tailscale 应用中关闭后重新开启。',
      '确认电脑未休眠，并在 tailnet 中显示为已连接。',
      '更新 Tailscale 应用，新版本包含重连问题修复。'
    ]
  },
  {
    id: 'vpn',
    icon: Shield,
    title: '其他 VPN 干扰',
    steps: [
      '非 Tailscale VPN 可能把本地流量转发到远端服务器。',
      '关闭该 VPN，或启用分流及“允许局域网”选项。'
    ]
  }
]
