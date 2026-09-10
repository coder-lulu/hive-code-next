# Mobile Browser 开发环境实测（2026-09-10）

## 环境

- 桌面：当前源码 Electron/Vite 开发模式，CDP 9444、Vite 5173、Runtime 6769。
- 独立数据目录：`E:/hive-build/browser-runtime-dev`；已安装客户端及其账号数据未替换。
- Android：`emulator-5554`，现有登录数据保留，Metro 8081 加载当前源码。
- 通过正常配对确认及 `adb reverse tcp:6769 tcp:6769` 连接开发 Runtime。
- 测试网页：本机 `127.0.0.1:18888`，静态标题及点击计数按钮。

## 已验证

1. 普通文件夹 Browser 创建从 Git 专用选择器改用现有 Browser 工作区解析器；新建请求成功，返回页面 ID。
2. Git 工作区手机 UI 新建 Browser 成功。
3. 普通文件夹手机 UI 新建 Browser 成功，收到测试网页画面；点击按钮返回 `handled: true`，画面计数从 0 变为 1。
4. 开发端直连配对暴露了独立缺陷：手机 `RpcClientSocketSession` 仍发送旧握手，而桌面仅接受 v2。已接入现有 `MobileE2EEV2ClientSession` / `MobileE2EEV2PhysicalChannel`，删除旧握手及收发实现，正常配对成功。未放宽认证。
5. 新增真实桌面/手机密码学实现互通测试：认证、RPC、二进制帧、认证拒绝、错误固定公钥拒绝。原连接生命周期测试使用独立帧桩，继续检查超时、重连与请求行为。

本轮手机相关测试 24 文件、112 通过、3 项原有跳过；手机类型检查、本次改动 lint 和格式检查通过。日志位于 `E:/hive-build/browser-direct-final-tests.log`、`browser-mobile-typecheck.log`、`browser-direct-mobile-all-lint.log`。

## 尚未通过：重启恢复

使用正常文件夹空间结构创建 Browser，正常退出开发端后以同一数据目录重启。恢复后：

- 文件夹、Browser workspace、page、统一标签及分组均在 renderer store 中恢复，页面 ID 未改变。
- renderer 构建的会话快照仍包含 Browser。
- Runtime 返回给手机的 `session.tabs.list` 却为空；按原标签 ID 调用 `session.tabs.close` 返回 `tab_not_found`。
- `runtime-mobile-session-projection.ts` 会过滤 `getLiveBrowserTabs` 中不存在的页面。恢复页尚未挂载/注册，因而不对手机发布。

下一步应处理恢复页按需挂载/注册与目录发布的衔接，并复测重启后打开、传流、关闭；不能仅移除 live-page 过滤，否则会发布不可操作或已销毁的页面。

本轮未复现“Browser 变为空白 Terminal”，也不能宣称此现象已修复。公网账号中继及 DESKTOP-UL1DAG2 上的安装包尚未使用这次代码完成复测。

第一次测试空间缺少 `parentPath`，其目录记录被加载规范化排除；该次结果不用于判断正常空间的重启行为。随后以带父目录的空间重测得到了上述恢复缺口。

## UI 验证边界

新建输入框沿用现有主题和尺寸 token，新增错误提示及提交中禁用状态；亮/暗主题组件测试通过。本轮未覆盖 130% 字号、所有小屏及读屏器，未新增视觉 token。

开发端与 Metro 保留运行；未生成安装包、未推送代码、未运行 GitHub Actions。

## 可见窗口补充验证

后台测试窗口通过 Win32 直接显示时，出现系统窗口白屏但 CDP 有页面内容的情况。
随后关闭该实例，去掉 `ORCA_BACKGROUND_LAUNCH`，按用户要求以正常可见模式启动，
保留原开发数据目录。Windows 原生窗口截图与 CDP 均确认首页和侧栏已显示。
这项启动方式修正不代表上述 Browser 重启恢复缺口已解决。
