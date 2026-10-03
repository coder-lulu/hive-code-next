export type MobileHomeConnectionMethod = 'scan' | 'account'

export const mobileHomeConnectionContent = {
  scan: {
    title: '电脑就在身边',
    description: '打开电脑端二维码，用手机扫描连接。',
    help: '连接遇到问题？',
    steps: [
      { title: '打开电脑端 HiveCode', description: '在连接设置中显示配对二维码' },
      { title: '使用手机扫描二维码', description: '点击上方按钮，扫描电脑屏幕' },
      { title: '连接后继续工作', description: '查看会话，进入终端' }
    ]
  },
  account: {
    title: '从账号中选择电脑',
    description: '登录 HiveCloud，查看并连接已认领的电脑。',
    help: '如何认领电脑？',
    steps: [
      { title: '登录 HiveCloud 账号', description: '使用你的 HiveCloud 账号登录' },
      { title: '选择已认领的电脑', description: '查看账号下可连接的设备' },
      { title: '连接后继续工作', description: '打开电脑上的会话与终端' }
    ]
  }
} as const
