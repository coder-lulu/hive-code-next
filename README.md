<h1 align="center">
  <img src="resources/build/icon.png" alt="HiveCode" width="64" valign="middle" /> HiveCode
</h1>

<p align="center">面向并行 AI 编程的工作台，把智能体、Git 工作树、终端和代码审阅放在一起。</p>

HiveCode 提供 macOS、Windows 和 Linux 桌面客户端，以及 Android、iOS 和浏览器访问入口。桌面、手机和浏览器可以连接同一运行主机，查看项目、工作树与会话，并继续处理正在进行的开发任务。

## 核心能力

| 能力              | 当前实现                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| 项目与 Git 工作树 | 导入本地目录或克隆仓库，创建、切换和管理独立工作树，为并行任务隔离工作目录。                         |
| 智能体会话        | 接入 Codex、Claude Code、OpenCode、Gemini、Pi 等工具，在工作树中运行多个会话，查看输出、状态和历史。 |
| HiveCode AI       | 基于随应用提供的 Pi，通过 Hive 账户接入已授权模型，支持模型选择和对话。                              |
| 终端与文件        | 使用集成终端、文件浏览与编辑、Markdown 预览和文件搜索。                                              |
| 代码审阅          | 查看 Git 改动和差异，执行提交操作，处理已连接代码托管平台上的 PR。                                   |
| 浏览器工具        | 使用浏览器视图，以及页面操作、截图、控制台和网络检查工具。                                           |
| 远程工作          | 连接 SSH 主机或已配对的运行主机，访问其项目、终端与会话。                                            |
| 移动协作          | 配对后查看工作区、会话、终端、文件、源码管理、任务与智能体历史，并使用已配置的通知能力。             |

第三方智能体需要安装对应工具，并完成各自的账户登录或 API 授权。不同工具提供的模型、额度和会话能力由其自身服务决定。

## 桌面、手机与浏览器

桌面客户端提供完整工作台。移动客户端通过扫码或配对信息连接运行主机；浏览器客户端也通过配对访问同一主机的数据和会话。

桌面与无界面模式共享同一套运行服务（runtime）。运行主机可以在没有桌面窗口的模式下工作，适用于服务器与远程开发。客户端需要能够访问主机端点；SSH 转发、局域网或其他已配置网络可以提供连接通道。浏览器与终端相关功能仍需要目标系统的原生运行依赖。

Hive 账户登录、模型服务和账户中继需要可用的 Hive 后端及有效授权。登录渠道以服务实际返回的能力为准；通知还需要系统权限与对应平台的推送配置。

## 从源码开发

需要 Git、Node.js **24.18.0**、pnpm **12.0.0**，以及当前平台的原生编译工具。精确版本与平台约束见 [工具链配置](config/toolchain.json)。

获取源码后，在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --dir mobile install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会准备内置 Pi 依赖与 Electron 原生运行环境，再启动桌面开发模式。移动端使用独立的依赖目录和锁文件。

首次运行完整 `pnpm test` 前，执行 `node config/scripts/prepare-cross-version-baselines.mjs` 获取跨版本测试所需的固定上游快照，并在同一终端设置 `ORCA_CROSS_VERSION_BASELINE_REF=v1.4.186`。Bash 使用 `export ORCA_CROSS_VERSION_BASELINE_REF=v1.4.186`，PowerShell 使用 `$env:ORCA_CROSS_VERSION_BASELINE_REF='v1.4.186'`。这些快照用于历史回归验证，不会写入公开分支或创建发布标签；涉及真实 shell 的测试还需要本机安装相应工具。

常用检查：

```bash
pnpm run typecheck
pnpm lint
pnpm test

pnpm --dir mobile typecheck
pnpm --dir mobile lint
pnpm --dir mobile test
```

完整单测使用产品固定的 Node 版本。需要私有 HiveRelay Cell 源码与 BEAM 工具链的真实 mTLS 集成验证由 [Cell 私有 Actions](https://github.com/coder-lulu/hive-relay-cell/actions/workflows/client-mtls-integration.yml) 执行，并记录被验证的公开源码提交。获授权的开发者也可设置 `HIVE_RELAY_CELL_SOURCE` 为 Cell 源码的绝对路径，准备 Elixir `1.20.2-otp-29`、Erlang `29.0.3` 与 Mix 依赖，再执行 `pnpm run test:integration:relay-cell`。该检查验证客户端证书准入，不会以缺少依赖为成功。

只构建桌面应用代码时，可运行 `pnpm run build:desktop`。生成安装包使用下面的客户端构建入口。

## CLI 与运行主机

CLI 主命令是 `hive`，桌面安装包包含 CLI。开发时也可以构建 CLI 并查看命令帮助：

```bash
pnpm run build:cli
node out/cli/index.js --help
```

安装好 CLI 后：

```bash
hive --help
hive project list
hive worktree list
hive serve
```

`hive serve` 在前台启动无桌面窗口的运行服务，输出端点与配对状态，使用 `Ctrl+C` 停止。包含 Web 客户端的构建还会输出浏览器访问地址。

可以使用 `hive serve --mobile-pairing` 获取移动端配对信息；`--port` 指定端口，`--pairing-address` 指定客户端可访问的地址。连接与操作仍受配对、身份和主机权限约束。

## 构建客户端

统一入口会检查工具链、准备依赖与构建资源，并验证产物。先针对本机桌面平台执行：

```bash
pnpm run clients:doctor -- --target desktop
pnpm run clients:prepare -- --target desktop
pnpm run clients:build -- --target desktop
```

输出保存在 `dist/<版本>/` 下。目标及产物类型如下：

| 目标          | 构建主机                | 产物                                                          |
| ------------- | ----------------------- | ------------------------------------------------------------- |
| `windows-x64` | Windows x64             | NSIS 安装程序 `.exe`                                          |
| `macos-x64`   | macOS Intel             | `.dmg`、`.zip`                                                |
| `macos-arm64` | macOS Apple Silicon     | `.dmg`、`.zip`                                                |
| `linux-x64`   | Linux x64               | `.AppImage`、`.deb`、`.rpm`、运行主机 `.deb`，以及 Web 静态包 |
| `linux-arm64` | Linux arm64             | `.AppImage`、`.deb`、`.rpm`、运行主机 `.deb`                  |
| `android`     | Windows、macOS 或 Linux | 已签名的 Release `.apk`、`.aab`                               |
| `ios`         | macOS                   | 未分发签名的设备归档与模拟器应用包                            |

构建其他目标时，将三个命令中的 `desktop` 替换为表中的目标名称。Android 需要 JDK、Android SDK 及配置好的 Release 签名密钥；iOS 需要 macOS 和匹配的 Xcode。平台版本配置见 [客户端构建配置](config/client-build.json)，本机路径配置可参考 [配置模板](config/client-build.local.example.json)。凭据与签名密钥保存在私有配置中。

**当前 iOS 流程不生成可直接安装到设备的 IPA。** Windows 和 macOS 的通用构建产物也不能视为已完成正式分发签名；正式分发需要对应证书、签名与平台验证。

本机 `--target all` 选择当前系统的桌面目标、Android，以及 macOS 上的 iOS。跨平台构建由 [客户端构建工作流](.github/workflows/hivecode-client-build.yml) 在各平台原生 runner 上分别执行。

## 贡献与文档

修改前请阅读 [贡献指南](.github/CONTRIBUTING.md)。提交变更时应验证涉及的平台、远程连接和授权边界，并附上有意义的测试结果。

内部设计、运维和审计资料通过 `docs` 私有子模块维护，需要单独授权。公开源码的普通开发、测试和客户端构建使用公开仓库中的代码与配置。

维护者通过 [Upstream Sync](.github/workflows/upstream-sync.yml) 跟随 Orca 更新。同步以 `config/upstream-sync-state.json` 中已审核的上游提交为基准，并保留 `config/upstream-change-ledger.json` 中的吸收与延期记录；源码采用三方内容合并，经过产品边界复核和测试后推送主分支，审核游标才会生效。冲突、私有文档变更或未完成的必要修复会阻止发布。操作约束见 [上游同步说明](.github/CONTRIBUTING.md#upstream-synchronization)。

## 开源许可与致谢

HiveCode 基于 Stably AI 的开源项目 [Orca](https://github.com/stablyai/orca) 开发，遵循 [MIT License](LICENSE)。原始版权声明与许可条件保留在许可证文件中。感谢 Orca、Stably AI 及相关开源项目的贡献者。
