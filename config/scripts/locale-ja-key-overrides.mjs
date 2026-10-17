// Japanese overrides for English values whose translation depends on the call site.
export const JA_KEY_OVERRIDES = {
  // "on" is the toggle state here, but the preposition in the delete confirmation below.
  'auto.components.github.PRFilterSections.1e9b5244f2': { ja: 'オン' },
  'auto.components.settings.TerminalPane.29154326bb': { ja: 'オン' },
  'auto.components.automations.AutomationsPage.1b586f0e2b': { ja: 'の' },
  // Bare "Open" is the PR state elsewhere; these two are the action, as ko/zh/es render it.
  'auto.components.browser.pane.BrowserPane.756bfc25c9': { ja: '開く' },
  'auto.components.right.sidebar.checks.panel.content.7c1f0a2b11': { ja: '開く' }
}

// Reviewed Hive translations retained across upstream catalog regeneration.
Object.assign(JA_KEY_OVERRIDES, {
  'auto.components.terminal.pane.zcode.missing.tui.description': {
    ja: 'HiveCode のフックは正しくインストールされていますが、PATH 上の zcode ではセッションを開けません。ZCode デスクトップアプリには、ターミナル UI を含まないエージェント Runtime が同梱されています。TUI を含む zcode をインストールし、HiveCode の外で zcode を実行して確認してください。'
  },
  'auto.components.settings.ReleaseChannelSection.description': {
    ja: '更新チャンネルを切り替えるか、過去のものを含む公開済みビルドに移動します。ダウングレードは可能ですが、未検証のビルドは正常に動作しない場合があります。'
  },
  'auto.components.settings.ReleaseChannelSection.hourlyWarning': {
    ja: '毎時ビルドはテストなしで main から直接公開され、Windows 版は署名されていません。安定版を手元に用意してください。'
  },
  'auto.components.settings.ReleaseChannelSection.dailyWarning': {
    ja: '日次ビルドはテストなしで main から直接公開され、Windows 版は署名されていません。安定版を手元に用意してください。'
  },
  'auto.components.settings.ReleaseChannelSection.adhocWarning': {
    ja: 'Adhoc ビルドは未マージのブランチから作成され、Windows 版は署名されていません。作成者が保守を止める場合もあるため、安定版を手元に用意してください。'
  },
  'auto.components.settings.ReleaseChannelSection.refresh': {
    ja: 'ビルド一覧を更新'
  },
  'auto.components.settings.ReleaseChannelSection.switchTo': {
    ja: 'ビルドに切り替え'
  },
  'auto.components.settings.ReleaseChannelSection.devChannelUnsupported': {
    ja: '{{value0}} ビルドは {{value1}} 向けのみです。Linux は Stable または RC を使用します。'
  },
  'auto.components.settings.ReleaseChannelSection.manualInstallHint': {
    ja: 'Windows の {{value0}} ビルドは署名されていないため、アプリ内更新で署名済みビルドに上書きできません。ダウンロードしたインストーラーを一度実行してください。Windows は発行元不明の警告を表示しますが、その後は Stable への復帰を含め、ここから切り替えられます。'
  },
  'settings.browser.userAgent.resetRequiredCommand': {
    ja: 'コマンドラインからリセットします: hive browser identity set --mode <mode> --reset'
  },
  'worktreeJumpPalette.linearIssue.loadingHint': {
    ja: 'Linear の Issue を読み込み中…'
  },
  'auto.store.slices.worktrees.metadata.worktree.meta.persist.877e3638d8': {
    ja: 'リンクされた Issue を変更するにはリモートランタイムを更新してください'
  },
  'auto.components.status.bar.StatusBar.zcodeUsageMenu': {
    ja: 'ZCode 使用量'
  },
  'auto.components.sidebar.WorktreeIssueLinkField.72486800ff': {
    ja: '保存すると {{first}} と {{second}} のリンクを解除します。ワークスペースが追跡できる Issue は 1 件です。'
  },
  'auto.components.sidebar.WorktreeIssueLinkField.2c245ac134': {
    ja: '保存すると {{link}} のリンクを解除します。ワークスペースが追跡できる Issue は 1 件です。'
  },
  'auto.components.sidebar.WorktreeIssueLinkField.f047887705': {
    ja: 'GitHub または Linear の URL を貼り付けるか、番号を入力してください。リンクを解除するには空欄にしてください。'
  },
  'auto.components.sidebar.WorktreeIssueLinkField.662ae142f8': {
    ja: 'Issue 番号、GitHub または Linear の URL'
  },
  'auto.components.settings.OrchestrationPane.nestedWorkerDepthDescription': {
    ja: '派遣されたワーカーが独自のワーカーを生成できる世代数です。1 ではエージェントツリーが平坦になり、コーディネーターが派遣したワーカーは追加のワーカーを派遣しません。'
  },
  'auto.components.settings.appearance.search.zcodeUsageTitle': {
    ja: 'ZCode 使用量'
  },
  'auto.components.settings.task.tracker.integration.cards.linearTokenName': {
    ja: 'お使いの Linear API トークン'
  },
  'auto.components.settings.ReleaseChannelSection.switchFailed': {
    ja: 'そのビルドに切り替えられませんでした。'
  },
  'auto.components.settings.ReleaseChannelSection.devOnly': {
    ja: '開発専用'
  },
  'auto.components.settings.ReleaseChannelSection.alreadyRunning': {
    ja: '現在実行中のビルドです。'
  },
  'auto.components.settings.EphemeralVmCleanupStopDialog.cancel': {
    ja: 'クリーンアップを継続'
  },
  'auto.components.new.workspace.SmartWorkspaceNameField.loadingLinearIssue': {
    ja: 'Linear の Issue を読み込み中…'
  },
  'auto.components.task.page.hooks.use.task.page.session.resume.savedLinearProjectMissing': {
    ja: '保存済みの Linear プロジェクトが見つかりませんでした。'
  },
  'auto.components.task.page.hooks.use.task.page.session.resume.savedLinearProjectRestoreFailed': {
    ja: '保存済みの Linear プロジェクトを復元できませんでした。'
  },
  'auto.components.task.page.hooks.use.task.page.session.resume.savedLinearViewMissing': {
    ja: '保存済みの Linear ビューが見つかりませんでした。'
  }
})
