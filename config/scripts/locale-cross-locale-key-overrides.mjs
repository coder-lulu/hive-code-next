export const CROSS_LOCALE_KEY_OVERRIDES = {
  'auto.components.GitLabItemDialog.4168eb2c51': {
    zh: '解决',
    ja: '解決'
  },
  'auto.components.TaskPage.524f095d55': {
    zh: '待评审',
    ja: 'レビュー待ち'
  },
  'auto.components.TaskPage.9cd11ba218': {
    zh: 'Jira',
    ja: 'Jira'
  },
  'auto.components.github.PRFilterDropdowns.19bb6f115f': {
    zh: 'reviewed-by',
    ja: 'reviewed-by'
  },
  'auto.components.onboarding.OnboardingFlow.a5e5da02f7': {
    zh: '集成',
    ja: '連携'
  },
  // Search-match fragment concatenated flush after the visible theme count; MT dropped the
  // en leading space that separates it from the count.
  'auto.components.settings.SettingsFormControls.c822571b2e': {
    zh: ' 匹配“{{value0}}”',
    ja: ' 「{{value0}}」に一致'
  },
  // Total-count fragment on the same row; without the separator "Showing 30 of 30"
  // rendered as "表示中 3030の" / "显示中 3030 的".
  'auto.components.settings.SettingsFormControls.cb330ef7f8': {
    zh: '/{{value0}}',
    ja: '/{{value0}}'
  },
  'auto.components.settings.TasksPane.6b23a34f6d': {
    zh: 'Jira',
    ja: 'Jira'
  },
  'auto.components.settings.integrations.search.03a7b275be': {
    zh: 'ADO',
    ja: 'ADO'
  },
  'auto.components.settings.integrations.search.129fc59aa8': {
    zh: 'Gitea',
    ja: 'Gitea'
  },
  'auto.components.settings.integrations.search.20540996ef': {
    zh: '凭据',
    ja: '認証情報'
  },
  'auto.components.settings.integrations.search.581844769a': {
    zh: 'MR',
    ja: 'MR'
  },
  'auto.components.settings.integrations.search.617603509b': {
    zh: 'Jira 集成',
    ja: 'Jira 連携'
  },
  'auto.components.settings.integrations.search.67a2a0e868': {
    zh: 'Bitbucket 集成',
    ja: 'Bitbucket 連携'
  },
  'auto.components.settings.integrations.search.aab86d64e5': {
    zh: 'Gitea 集成',
    ja: 'Gitea 連携'
  },
  'auto.components.settings.integrations.search.af6611fa6e': {
    zh: 'Azure DevOps 集成',
    ja: 'Azure DevOps 連携'
  },
  'auto.components.settings.integrations.search.b027b4b318': {
    zh: 'Linear 集成',
    ja: 'Linear 連携'
  },
  'auto.components.settings.integrations.search.b40cbe5de4': {
    zh: 'glab',
    ja: 'glab'
  },
  'auto.components.settings.integrations.search.b50b71ef9d': {
    zh: 'GitLab 集成',
    ja: 'GitLab 連携'
  },
  'auto.components.settings.integrations.search.b79c21bd42': {
    zh: 'GitHub',
    ja: 'GitHub'
  },
  'auto.components.settings.integrations.search.c450244ad7': {
    zh: '集成',
    ja: '連携'
  },
  'auto.components.settings.integrations.search.e1263dd748': {
    zh: 'Jira',
    ja: 'Jira'
  },
  'auto.components.settings.integrations.search.f16e41cc72': {
    zh: 'GitHub 集成',
    ja: 'GitHub 連携'
  },
  'auto.components.settings.jira.integration.card.09742875cd': {
    zh: 'Jira',
    ja: 'Jira'
  },
  'auto.components.sidebar.workspace.status.409528031f': {
    zh: '评审',
    ja: 'レビュー'
  },
  'auto.components.sidebar.workspace.status.6c1efa2cf8': {
    zh: '评审中',
    ja: 'レビュー中'
  },
  'auto.components.sidebar.workspace.status.caebe3c10f': {
    zh: 'Conductor 评审',
    ja: 'Conductor レビュー'
  },
  'auto.components.sidebar.worktree.list.groups.6798dc7c94': {
    zh: '评审中',
    ja: 'レビュー中'
  },
  'auto.components.status.bar.WorkspaceSpaceCompactPanel.c361440dc0': {
    zh: '测试版',
    ja: 'ベータ'
  },
  'auto.components.workspace.cleanup.WorkspaceCleanupDialog.1b18868569': {
    zh: '待评审',
    ja: 'レビュー待ち'
  },
  'auto.components.workspace.space.WorkspaceSpacePage.e8d6ba11ab': {
    zh: '测试版',
    ja: 'ベータ'
  },
  'auto.hooks.useSettingsNavigationMetadata.40d80bad8a': {
    zh: '测试版',
    ja: 'ベータ'
  },
  // Issue/PR state picker; it sits beside 已关闭, so 进行中 is a different state.
  'auto.components.PullRequestPage.7b8f6bf6d8': {
    zh: '开放'
  },
  // This "Open" is the button that opens the config file, not an issue state.
  'auto.components.settings.McpConfigFileRow.e720c139cd': {
    zh: '打开'
  },
  // Terminal cursor-color group: the on-screen cursor, not the Cursor editor.
  'auto.components.settings.TerminalWindowSection.c9e1fdf42f': {
    ko: '커서',
    zh: '光标'
  },
  'auto.components.onboarding.ThemeStep.ab2a583a97': {
    ko: '커서',
    zh: '光标'
  },
  // Tailwind swatch labels: bare 天空 (the sky), 锌 and 空 (the metal, the sky) are not colors.
  'auto.components.sidebar.workspace.status.6437a8c253': {
    zh: '天蓝',
    ja: '空色'
  },
  'auto.components.sidebar.workspace.status.caabd5ca85': {
    zh: '锌灰'
  }
}

// Reviewed Hive translations retained across upstream catalog regeneration.
Object.assign(CROSS_LOCALE_KEY_OVERRIDES, {
  'auto.components.WorktreeJumpPalette.worktreesHeader': {
    es: 'Espacios de trabajo'
  },
  'auto.components.terminal.pane.zcode.missing.tui.title': {
    es: 'Esta versión de ZCode no tiene interfaz de terminal',
    fr: 'Cette version de ZCode n’a pas d’interface de terminal',
    zh: '此 ZCode 版本不包含终端界面'
  },
  'auto.components.terminal.pane.zcode.missing.tui.description': {
    es: 'Los hooks de HiveCode se instalaron correctamente, pero el zcode de tu PATH no puede abrir una sesión. La aplicación de escritorio de ZCode incluye el Runtime del agente sin su interfaz de terminal. Instala una versión de zcode que incluya la TUI y ejecútala fuera de HiveCode para comprobarlo.',
    fr: 'Les hooks de HiveCode sont correctement installés, mais le zcode présent dans votre PATH ne peut pas ouvrir de session. L’application ZCode pour ordinateur inclut le Runtime de l’agent sans son interface de terminal. Installez une version de zcode avec la TUI, puis exécutez zcode en dehors de HiveCode pour vérifier.',
    zh: 'HiveCode 的钩子已正确安装，但 PATH 中的 zcode 无法打开会话。ZCode 桌面应用附带的 Agent 运行时不包含终端界面。请安装包含 TUI 的 zcode，然后在 HiveCode 之外运行 zcode 进行确认。'
  },
  'auto.components.terminal.pane.TerminalRemoteRuntimeReconnectBanner.retryingBody': {
    es: 'HiveCode está reintentando automáticamente. Este terminal se reanudará si se restablece la conexión.'
  },
  'auto.components.settings.ReleaseChannelSection.description': {
    es: 'Cambia de canal de actualizaciones o a cualquier compilación publicada, incluidas las anteriores. Se permite instalar versiones anteriores y las compilaciones no verificadas pueden fallar.',
    zh: '切换更新渠道或跳转到任何已发布的构建，包括较旧的构建。允许降级，未经验证的构建可能无法正常工作。'
  },
  'auto.components.settings.ReleaseChannelSection.hourlyWarning': {
    es: 'Las compilaciones de cada hora se publican directamente desde main sin pasar pruebas y las de Windows no están firmadas. Ten a mano una compilación estable.',
    zh: '每小时构建直接从 main 发布，没有测试门槛，且 Windows 版本未签名。请备好稳定版本。'
  },
  'auto.components.settings.ReleaseChannelSection.dailyWarning': {
    es: 'Las compilaciones diarias se publican directamente desde main sin pasar pruebas y las de Windows no están firmadas. Ten a mano una compilación estable.',
    zh: '每日构建直接从 main 发布，没有测试门槛，且 Windows 版本未签名。请备好稳定版本。'
  },
  'auto.components.settings.ReleaseChannelSection.adhocWarning': {
    es: 'Las compilaciones ad hoc provienen de una rama aún no integrada y las de Windows no están firmadas. Quien las publique podría abandonarlas; ten a mano una compilación estable.',
    zh: '临时构建来自尚未合入的分支，且 Windows 版本未签名。发布者可能不再维护该构建，请备好稳定版本。'
  },
  'auto.components.settings.ReleaseChannelSection.refresh': {
    es: 'Actualizar lista de compilaciones'
  },
  'auto.components.settings.ReleaseChannelSection.cacheHint': {
    es: 'Las listas de compilaciones se guardan en caché durante 5 minutos. Actualiza para comprobar si hay nuevas compilaciones.'
  },
  'auto.components.settings.ReleaseChannelSection.switchTo': {
    es: 'Cambiar a la compilación'
  },
  'auto.components.settings.ReleaseChannelSection.devChannelUnsupported': {
    es: 'Las compilaciones {{value0}} solo se generan para {{value1}}. Linux permanece en Estable o RC.',
    zh: '{{value0}} 构建仅针对 {{value1}} 发布。Linux 继续使用 Stable 或 RC。'
  },
  'auto.components.settings.ReleaseChannelSection.manualInstallHint': {
    es: 'Las compilaciones {{value0}} no están firmadas en Windows, así que el actualizador de la aplicación no puede instalarlas sobre una compilación firmada. Ejecuta una vez el instalador descargado; Windows advertirá que el editor es desconocido. Todos los cambios posteriores, incluida la vuelta a Estable, funcionarán desde aquí.',
    zh: '{{value0}} 构建在 Windows 上未签名，因此应用内更新器无法用它覆盖已签名的构建。请运行一次下载的安装程序；Windows 会警告发布者未知。此后所有切换，包括切回 Stable，都可在此完成。'
  },
  'settings.browser.userAgent.resetRequiredCommand': {
    fr: 'Réinitialisez-le à partir de la ligne de commande : hive browser identity set --mode <mode> --reset'
  },
  'auto.components.settings.ReleaseChannelSection.alreadyRunning': {
    zh: '这是您当前运行的构建。'
  },
  'auto.components.settings.ReleaseChannelSection.loadingBuilds': {
    zh: '正在加载构建…'
  },
  'auto.components.settings.ReleaseChannelSection.noBuilds': {
    zh: '未找到构建'
  },
  'auto.components.settings.ReleaseChannelSection.webUnavailable': {
    zh: '切换构建仅在桌面应用中可用。'
  },
  'components.workspace.cleanup.browse.checkingGit': {
    zh: '正在检查 Git 状态：剩余 {{value0}} 项'
  },
  'components.workspace.cleanup.browse.facet.size': {
    zh: '磁盘占用'
  },
  'components.workspace.cleanup.browse.minAhead': {
    zh: '领先提交数 ≥'
  },
  'components.workspace.cleanup.browse.ticketPresence': {
    zh: '关联的工单'
  },
  'components.workspace.cleanup.browse.blockerMode': {
    zh: '阻碍条件匹配'
  },
  'components.workspace.cleanup.browse.blockerModeAny': {
    zh: '存在任意一项'
  },
  'components.workspace.cleanup.browse.blockers': {
    zh: '阻碍因素'
  },
  'components.workspace.cleanup.browse.selectableOnly': {
    zh: '仅显示当前可删除的工作区'
  },
  'components.workspace.cleanup.browse.sort.localContext': {
    zh: '打开的上下文'
  },
  'components.workspace.cleanup.browse.sort.blockerCount': {
    zh: '阻碍因素'
  },
  'components.workspace.cleanup.browse.git.clean': {
    zh: '无未提交更改'
  },
  'components.workspace.cleanup.browse.agent.idle': {
    zh: '空闲'
  }
})
