<h1 align="center">
  <img src="../../resources/build/icon.png" alt="HiveCode" width="64" valign="middle" /> HiveCode
</h1>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Supported platforms: macOS, Windows, and Linux" />
</p>

<p align="center">
  <sub><a href="../../README.md">English</a> · <a href="README.zh-CN.md">中文</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a></sub>
</p>

<p align="center">
  <strong>100x ビルダーのための AI オーケストレーター。</strong><br/>
  Codex、Claude Code、OpenCode、Pi を並べて実行 — それぞれを専用のワークツリーで動かし、1 か所で追跡できます。
</p>

> [!IMPORTANT]
> HiveCode は現在エンジニアリング fork であり、承認済みの公開ダウンロード、更新、クラウド、サポート、コミュニティのエンドポイントはありません。以下の機能リンクとスクリーンショットは互換性の参考として upstream Orca から引き継いだもので、HiveCode のリリースリンクではありません。

<p align="center">
  <img src="../assets/readme-hero.jpg" alt="upstream Orca のデスクトップおよびモバイル UI リファレンス" width="960" />
</p>

## 機能

<table>
<tr>
<td width="50%" valign="middle">

### モバイル Companion

スマートフォンからエージェントを監視・操作 — エージェントの完了を通知で受け取り、どこからでもフォローアップを送信できます。

[upstream Orca モバイル互換性ドキュメント →](https://www.onorca.dev/docs/mobile)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/mobile"><picture><source srcset="../assets/feature-wall/mobile-companion-app-showcase.gif" type="image/gif"><img src="../assets/feature-wall/mobile-companion-app-showcase.jpg" alt="HiveCode デスクトップとモバイル companion アプリ" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 並列ワークツリー

1 つのプロンプトを 5 つのエージェントに展開し、それぞれを独立した git ワークツリーで実行 — 結果を比較して、最良のものをマージできます。

[ドキュメント →](https://www.onorca.dev/docs/model/worktrees)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/model/worktrees"><picture><source srcset="../assets/feature-wall/parallel-worktrees.gif" type="image/gif"><img src="../assets/feature-wall/parallel-worktrees.jpg" alt="並列ワークツリーのオーケストレーション" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### ターミナル分割

WebGL レンダリング、無制限の分割、再起動後も残るスクロールバックを備えた Ghostty クラスのターミナル。

[ドキュメント →](https://www.onorca.dev/docs/terminal)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/terminal"><picture><source srcset="../assets/feature-wall/terminal-splits.gif" type="image/gif"><img src="../assets/feature-wall/terminal-splits.jpg" alt="ターミナル分割" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### デザインモード

実際の Chromium ウィンドウで任意の UI 要素をクリックすると、その HTML、CSS、切り抜いたスクリーンショットがそのままエージェントのプロンプトに送られます。

[ドキュメント →](https://www.onorca.dev/docs/browser/design-mode)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/browser/design-mode"><picture><source srcset="../assets/feature-wall/design-mode.gif" type="image/gif"><img src="../assets/feature-wall/design-mode.jpg" alt="組み込みブラウザとデザインモード" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub &amp; Linear をネイティブに

PR、Issue、プロジェクトボードをアプリ内で閲覧 — 任意のタスクからワークツリーを開き、コンテキストスイッチなしでレビューできます。

[ドキュメント →](https://www.onorca.dev/docs/review/linear)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/review/linear"><picture><source srcset="../assets/feature-wall/github-linear.gif" type="image/gif"><img src="../assets/feature-wall/github-linear.jpg" alt="HiveCode の GitHub と Linear タスクワークフロー" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### SSH ワークツリー

強力なリモートマシン上でエージェントを実行 — ファイル編集、git、ターミナルをフルに使え、自動再接続とポートフォワーディングも付属します。

[ドキュメント →](https://www.onorca.dev/docs/ssh)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/ssh"><picture><source srcset="../assets/feature-wall/ssh-worktrees.gif" type="image/gif"><img src="../assets/feature-wall/ssh-worktrees.jpg" alt="SSH 経由のリモートワークツリー" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### AI Diff に注釈

任意の Diff 行にコメントを付けてエージェントへ送り返せます — HiveCode から離れずにレビュー、編集、コミットまで完結します。

[ドキュメント →](https://www.onorca.dev/docs/review/annotate-ai-diff)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/review/annotate-ai-diff"><picture><source srcset="../assets/feature-wall/annotate-diff.gif" type="image/gif"><img src="../assets/feature-wall/annotate-diff.jpg" alt="AI が生成した Diff への注釈" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### ファイルをエージェントへドラッグ

オートセーブが全面的に効く VS Code のエディタ — ファイルや画像をそのままエージェントのプロンプトへドラッグできます。

[ドキュメント →](https://www.onorca.dev/docs/editing/file-explorer)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/editing/file-explorer"><picture><source srcset="../assets/feature-wall/file-drag.gif" type="image/gif"><img src="../assets/feature-wall/file-drag.jpg" alt="ファイルや画像をエージェントのプロンプトへドラッグ" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### HiveCode CLI

エージェント自身も HiveCode を操作できます — `hivecode worktree create`、`snapshot`、`click`、`fill` であらゆるワークフローをスクリプト化できます。

[ドキュメント →](https://www.onorca.dev/docs/cli/overview)

</td>
<td width="50%">
  <a href="https://www.onorca.dev/docs/cli/overview"><picture><source srcset="../assets/feature-wall/orca-cli.gif" type="image/gif"><img src="../assets/feature-wall/orca-cli.jpg" alt="CLI から HiveCode をスクリプト操作" width="100%" /></picture></a>
</td>
</tr>
</table>

**さらに同梱:**

- **[クイックオープン](https://www.onorca.dev/docs/model/quick-open)** — フローを離れずに、ワークツリー、ファイル、エージェント、コマンド、リポジトリコンテキストを横断検索できます。
- **[アカウント切り替えと使用量トラッキング](https://www.onorca.dev/docs/agents/usage-tracking)** — Claude と Codex の使用量やレート制限のリセットを確認し、再ログインなしでアカウントを切り替えられます。
- **[リッチなリポジトリプレビュー](https://www.onorca.dev/docs/editing/markdown)** — Markdown、画像、PDF、リポジトリ文書をワークスペース内でプレビューできます。
- **[Computer Use](https://www.onorca.dev/docs/cli/computer-use)** — 実際の操作が必要なワークフローでは、エージェントにデスクトップアプリや画面上の UI を操作させられます。
- **[通知と未読ステータス](https://www.onorca.dev/docs/notifications)** — エージェントの完了や要対応をすぐに把握し、スレッドを未読に戻して後で確認できます。

---

## 対応するエージェント

**あらゆる CLI エージェント**で動作します — ターミナルで動くものなら、HiveCode でも動きます。

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="../assets/claude-logo.svg" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=x.ai&sz=64" alt="Grok logo" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=cursor.com&sz=64" alt="Cursor logo" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://ampcode.com/manual#install"><kbd><img src="https://www.google.com/s2/favicons?domain=ampcode.com&sz=64" alt="Amp logo" width="16" valign="middle" /> Amp</kbd></a> &nbsp;
  <a href="https://openclaude.gitlawb.com/"><kbd><img src="../../resources/openclaude-logo.png" alt="OpenClaude logo" width="16" valign="middle" /> OpenClaude</kbd></a> &nbsp;
  <a href="https://antigravity.google/docs/cli-overview"><kbd><img src="https://www.google.com/s2/favicons?domain=antigravity.google&sz=64" alt="Antigravity logo" width="16" valign="middle" /> Antigravity</kbd></a> &nbsp;
  <a href="https://pi.dev"><kbd><img src="https://pi.dev/favicon.svg" alt="Pi logo" width="16" valign="middle" /> Pi</kbd></a> &nbsp;
  <a href="https://omp.sh"><kbd><img src="https://omp.sh/favicon.svg" alt="oh-my-pi logo" width="16" valign="middle" /> oh-my-pi</kbd></a> &nbsp;
  <a href="https://hermes-agent.nousresearch.com/docs/"><kbd><img src="https://www.google.com/s2/favicons?domain=nousresearch.com&sz=64" alt="Hermes Agent logo" width="16" valign="middle" /> Hermes Agent</kbd></a> &nbsp;
  <a href="https://block.github.io/goose/docs/quickstart/"><kbd><img src="https://www.google.com/s2/favicons?domain=goose-docs.ai&sz=64" alt="Goose logo" width="16" valign="middle" /> Goose</kbd></a> &nbsp;
  <a href="https://docs.augmentcode.com/cli/overview"><kbd><img src="https://www.google.com/s2/favicons?domain=augmentcode.com&sz=64" alt="Auggie logo" width="16" valign="middle" /> Auggie</kbd></a> &nbsp;
  <a href="https://github.com/autohandai/code-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=autohand.ai&sz=64" alt="Autohand Code logo" width="16" valign="middle" /> Autohand Code</kbd></a> &nbsp;
  <a href="https://github.com/charmbracelet/crush"><kbd><img src="https://www.google.com/s2/favicons?domain=charm.sh&sz=64" alt="Charm logo" width="16" valign="middle" /> Charm</kbd></a> &nbsp;
  <a href="https://docs.cline.bot/cline-cli/overview"><kbd><img src="https://www.google.com/s2/favicons?domain=cline.bot&sz=64" alt="Cline logo" width="16" valign="middle" /> Cline</kbd></a> &nbsp;
  <a href="https://www.codebuff.com/docs/help/quick-start"><kbd><img src="https://www.google.com/s2/favicons?domain=codebuff.com&sz=64" alt="Codebuff logo" width="16" valign="middle" /> Codebuff</kbd></a> &nbsp;
  <a href="https://commandcode.ai/docs/quickstart"><kbd><img src="https://www.google.com/s2/favicons?domain=commandcode.ai&sz=64" alt="Command Code logo" width="16" valign="middle" /> Command Code</kbd></a> &nbsp;
  <a href="https://docs.continue.dev/guides/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=continue.dev&sz=64" alt="Continue logo" width="16" valign="middle" /> Continue</kbd></a> &nbsp;
  <a href="https://docs.factory.ai/cli/getting-started/quickstart"><kbd><img src="../assets/droid-logo.svg" alt="Droid logo" width="16" valign="middle" /> Droid</kbd></a> &nbsp;
  <a href="https://kilo.ai/docs/cli"><kbd><img src="https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/kilo-vscode/assets/icons/kilo-light.svg" alt="Kilocode logo" width="16" valign="middle" /> Kilocode</kbd></a> &nbsp;
  <a href="https://www.kimi.com/code/docs/en/kimi-code-cli/getting-started.html"><kbd><img src="https://www.google.com/s2/favicons?domain=moonshot.cn&sz=64" alt="Kimi logo" width="16" valign="middle" /> Kimi</kbd></a> &nbsp;
  <a href="https://kiro.dev/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=kiro.dev&sz=64" alt="Kiro logo" width="16" valign="middle" /> Kiro</kbd></a> &nbsp;
  <a href="https://github.com/mistralai/mistral-vibe"><kbd><img src="https://www.google.com/s2/favicons?domain=mistral.ai&sz=64" alt="Mistral Vibe logo" width="16" valign="middle" /> Mistral Vibe</kbd></a> &nbsp;
  <a href="https://github.com/QwenLM/qwen-code"><kbd><img src="https://www.google.com/s2/favicons?domain=qwenlm.github.io&sz=64" alt="Qwen Code logo" width="16" valign="middle" /> Qwen Code</kbd></a> &nbsp;
  <a href="https://support.atlassian.com/rovo/docs/install-and-run-rovo-dev-cli-on-your-device/"><kbd><img src="https://www.google.com/s2/favicons?domain=atlassian.com&sz=64" alt="Rovo Dev logo" width="16" valign="middle" /> Rovo Dev</kbd></a> &nbsp;
  <kbd>+ any CLI agent</kbd>
</p>

---

## インストール

HiveCode は現在、承認済みのデスクトップ版またはモバイル版バイナリを公開していません。upstream Orca の release、App Store、TestFlight、Homebrew、AUR、APK リンクを HiveCode のインストール手順として使用しないでください。

ローカル開発：

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
```

デスクトップアプリは `pnpm run build:desktop` でビルドします。ネイティブビルドはプラットフォーム固有です。対応する `config/scripts/` のスクリプトを参照してください。

## 互換性

既存のインストールや永続化データを壊さないため、`orca`、`orca-ide`、`orca://`、`ORCA_*`、従来の `.orca` ディレクトリ、upstream プラグイン ID は保持されます。これらは互換性のための識別子であり、HiveCode の製品ブランドではありません。

## 開発について

コントリビューションと upstream 同期の境界は[コントリビューションガイド](../../.github/CONTRIBUTING.md)を参照してください。

## 帰属とライセンス

HiveCode は Stably AI のオープンソース [Orca](https://github.com/stablyai/orca) プロジェクトを基盤とし、[MIT ライセンス](../../LICENSE)で提供されます。
