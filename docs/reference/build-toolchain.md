# HiveCode 构建工具链

桌面端开发、测试和发布使用同一套工具链。版本只在根目录的
[`config/toolchain.json`](../../config/toolchain.json) 和
[`package.json`](../../package.json) 中声明；不要在 workflow 中另行升级版本。

| 项目 | 固定版本/环境 | 说明 |
| --- | --- | --- |
| Node.js | 24.18.0 | 本地由 `.node-version` 提供；GitHub Actions 使用同一文件 |
| pnpm | 10.24.0 | 由 `packageManager` 锁定，使用 `pnpm install --frozen-lockfile` |
| Electron | 43.1.0 | 桌面运行时和 electron-builder 的目标版本 |
| Vitest | 4.1.5 | 桌面测试 runner；`mobile/` 是独立项目，可按 Expo 兼容性使用自己的 4.1.x |

## 原生构建矩阵

| 目标 | GitHub Actions runner | 必备工具链 | 兼容性下限 |
| --- | --- | --- | --- |
| Windows x64/arm64 | `windows-2022` | Visual Studio 2022 MSVC v143（含 ARM64 交叉工具集）、Python 3 | Electron 43 原生 ABI |
| macOS x64/arm64 | `macos-15`（发布工作流使用等价的 `blacksmith-6vcpu-macos-15`） | Xcode Command Line Tools、`swiftc`、`xcodebuild` | Electron 43 原生 ABI |
| Linux x64 | `ubuntu-22.04` | `build-essential`、Python 3、`node-gyp` 11.5.0 | glibc 2.31（Ubuntu 20.04） |
| Linux arm64 | `ubuntu-24.04-arm` | 同 Linux x64 | 发布前必须通过 glibc floor 检查 |

Linux 的 runner 版本是刻意固定的；不要改回 `ubuntu-latest`，否则 native
module 可能链接到更高版本 glibc。打包会运行
[`verify-linux-glibc-floor.cjs`](../../config/scripts/verify-linux-glibc-floor.cjs)。

## 本地检查

```bash
node --version   # v24.18.0
pnpm --version   # 10.24.0
pnpm install
pnpm typecheck
pnpm test
```

PR 中的 Node 18 job 仅验证旧版 managed-hook 客户端兼容性，不参与桌面构建或
默认测试矩阵；不要将其作为本地开发版本。
