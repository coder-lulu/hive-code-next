# HiveCode 客户端固定构建流程

所有本地平台共用 `clients:doctor`、`clients:prepare`、`clients:build`。
不运行 GitHub Actions，不自动上传或安装。普通重试不修改版本。

## 工具链与设置

Node 24.18.0、pnpm 12.0.0、Electron 43.6.0；依据是 package.json、锁文件和 config/toolchain.json，预检验证一致性。
Android 精确约束在 config/client-build.json：JDK 17.0.18、Gradle 8.13、SDK/build-tools 36/36.0.0、NDK 27.1.12297006、CMake 3.22.1。
Windows 同时检查 MSVC 14.44.35207。工具版本不满足要求时在编译前退出。

安装固定 Node/pnpm 后，复制 config/client-build.local.example.json 到根目录 .client-build.local.json 并设置本机路径。该文件被 Git 忽略。入口只依赖 Node 和仓库中的进程执行模块，可在安装 JS 依赖前执行。
缓存默认 ~/.hivecode-build/cache，也可设置 HIVECODE_BUILD_HOME，例如 E:/hive-build。
已有机器可配置 pnpmStore（不含版本后缀）、gradleCache、builderCache、electronCache 复用原缓存，避免为了迁移而重新下载。
JAVA_HOME、ANDROID_HOME 和已有 HIVECODE_ANDROID_* 签名环境变量也可使用。androidSigningCredentials 只填写已有私密凭据文件的路径，不提交密钥或密码。
本机配置中的路径必须是绝对路径。Android 预检验证已有密钥库、别名和私钥密码；不会重新生成签名密钥。

## 操作

```sh
pnpm run clients:doctor -- --target all
pnpm run clients:prepare -- --target all
pnpm run clients:build -- --target all
```

prepare 包含联网资源准备和首次完整打包预热，冷缓存会较慢；成功验证后才记录准备完成。
JS 安装使用冻结锁文件；已有安装与锁文件、补丁和本地包一致时直接复用。Android 的 Gradle 依赖锁保存在 mobile/gradle-locks/，应随源码提交。prepare 写入锁后还会执行一次严格锁模式的离线构建，成功后才允许后续 build。
build 不执行 install/prebuild；Gradle 使用 --offline，Node 工具禁止外部连接。外部原生工具的网络行为仍须用实际离线验收覆盖，Node 限制并不等于操作系统网络隔离。
缺少准备记录或相关输入变化时要求重新 prepare。正常构建不清空共享缓存。
旧 Electron headers 可以通过 electronHeadersImport 导入含 SHASUMS256.txt、headers.tar.gz 和 Windows node.lib 的目录，并验证下载摘要。

工作区互斥锁防止受控构建互相重装依赖。构建期间不要手工 pnpm install。
异常退出留下的锁不会自动抢占；先核实原进程和子进程均已结束。
日志位于 dist/<版本>/logs/<尝试编号>/<目标>/。

## 平台矩阵

| target                  | 执行主机                                        | 产物               |
| ----------------------- | ----------------------------------------------- | ------------------ |
| windows-x64             | Windows x64、MSVC v143                          | exe、blockmap      |
| linux-x64 / linux-arm64 | 对应架构 Linux、原生编译工具、rpmbuild、objdump | AppImage、deb、rpm |
| macos-x64 / macos-arm64 | 对应架构 macOS、Xcode/Swift                     | 既有 mac 打包目标  |
| android                 | Windows/Linux/macOS、固定 Android 工具链        | 四 ABI APK         |

桌面必须在对应系统与架构的原生主机构建。desktop 代表当前主机桌面目标；all 代表当前桌面与 Android。
Linux/macOS 已有调度适配，尚须在对应主机真实验证。Linux 保留 glibc 2.31 与 GLIBCXX 3.4.28 的打包检查，macOS 保留原生辅助程序构建。
Windows ARM64、iOS 等未实现目标明确拒绝，后续增加目标、平台步骤和验证器，不新增另一套流程。iOS 需要 macOS/Xcode、签名和 provisioning 适配。

## 版本与交付

```sh
pnpm run clients:version -- --version 1.5.0-beta.3 --desktop-build 3 --android-code 21
```

示例仅用于显式版本升级，不应在重试时重复执行。ios-build 为可选递增参数，否则保留当前 iOS 编号。
版本修改后复核并提交源码，再 prepare。

每个平台交付到 dist/<版本>/<目标>/<尝试编号>/，含安装包、SHA256SUMS.txt、build-manifest.json。
dist/<版本>/<目标>/latest.json 只在验证通过后更新，各架构与失败尝试不覆盖已有成功结果。
Android 验证现有密钥证书、应用标识、版本和架构；Windows 记录实际 Authenticode 状态，要求硬件签名时不得降级。
固定输入和流程不代表带签名时间戳的安装包逐字节一致。

## 本机验证记录（2026-09-09）

Windows x64 与 Android 已通过统一的 clients:build -- --target all，尝试编号为 20260909T003002321Z。Windows 已验证重复构建时复用工作目录；Android 严格锁模式离线构建成功，944 个任务中 888 个为 up-to-date。两端 doctor 均显示 prepared，相关自动化测试共 40 项通过。

本次版本保持 1.5.0-beta.2，桌面构建号 2、Android versionCode 20。Android 使用原有发布密钥；Windows 安装包实际状态为 NotSigned。尚未验证全新主机冷缓存安装、安装后的应用交互，以及 Linux/macOS 原生构建。
