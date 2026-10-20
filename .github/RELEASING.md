# 发布 HiveCode

公网安装包统一由 `hivecode-publish-all.yml` 发布。`targets=linux-android` 发布 Linux
x64/arm64 的 AppImage、DEB、tar.gz 和 Android universal APK，共 7 个文件；默认
`targets=all` 还包含 Windows NSIS、macOS x64/arm64 ZIP 和 iOS 商店链接，共 11 项。
iOS 发布的是经过 Apple 可分发状态检查的 TestFlight/App Store 链接，不是公网 IPA。

## 准备一个新版本

1. 将根目录 `package.json`、`mobile/package.json`、`mobile/app.json` 的产品版本改成同一个值。
   Beta 使用 `X.Y.Z-beta.N`，正式版使用 `X.Y.Z`，并选择对应的 `beta` / `stable` channel。
2. 更新 `config/client-build.json` 的 `desktopBuildNumber`；更新 Android `versionCode`，使其高于已发布值。
   全平台发布时，iOS `buildNumber` 还必须高于 Apple 中该版本已有的构建号。
   桌面最终构建号由后端预留并冻结，以工作流的 `batch.json` 为准。
3. 如有发布服务端变更，先部署经验证的后端构建，并确认构建身份和数据库迁移状态正确。
   提交客户端 PR，等待该提交的 `PR checks passed` 汇总及全部必需检查通过，再正常合并。
   在合并提交上创建与产品版本一致的不可变 `v` 标签，并推送标签。不要移动已存在的版本标签。

例如，若下一个未占用版本为 `1.5.0-beta.36`，在经过检查的合并提交上执行：

```sh
git tag -a v1.5.0-beta.36 <merge-commit-sha> -m "HiveCode 1.5.0-beta.36"
git push hivecode-next v1.5.0-beta.36
```

推送版本标签不等于公网批次已发布。再运行统一发布工作流，工作流 ref 和 `source_ref`
必须选择同一个版本标签，以通过 OIDC 来源绑定：

```sh
gh workflow run hivecode-publish-all.yml --repo coder-lulu/hive-code-next --ref v1.5.0-beta.36 -f source_ref=v1.5.0-beta.36 -f channel=beta -f targets=linux-android -f release_notes="版本更新说明"
```

GitHub Actions 页面也可执行同样操作：选择 **Publish all HiveCode clients**，在 **Run workflow**
中同时选择版本标签和相同的 `source_ref`，填写 channel、targets 和更新说明。
示例标签仅用于说明；操作前确认版本和标签尚未使用。

## 发布前提

所有选中平台都必须具备真实签名材料、受保护的 `release-production` 环境、HiveCloud
OIDC 配置和证明密钥。Linux、Android 使用现有签名链路。切换为 `all` 前，还需准备：

- 在线的 Windows 硬件签名 runner，以及配置的签名命令与预期证书身份。
- macOS Developer ID 签名、公证凭据与相应 runner。
- iOS 分发证书、App Store Connect API 凭据；Beta 还需正确的外部 TestFlight 分组和公开邀请链接。
  正式版必须已在 App Store 可分发。Apple 审核未通过时，整个选中批次保持未发布。

缺少凭据或可分发条件会明确失败。不要用单平台工作流替代统一批次的公网发布步骤。

## 失败恢复与验收

优先在原始 Actions run 使用 **Re-run failed jobs**，保留相同来源、批次、构建号和构建文件：

```sh
gh run rerun <run-id> --failed --repo coder-lulu/hive-code-next
```

已验证的直接下载文件会复用。尚未发布的批次中，最终发布任务会重新检查 iOS 的 Apple
可分发状态，即使原 iOS 任务已成功或被跳过，也不能省略这次检查；已验证的构建不重复编译或上传。
已发布批次重跑时不再修改成员，继续进行公网验收。
若重新编译产生了不同文件，哈希冲突会阻止覆盖，应修复问题后使用新版本重新发布。

不要改写旧标签、替换同一版本的文件，或手工修改数据库状态。批次发布是一个数据库事务，
所有选中产物验证完成后才统一公开。公网下载验收发生在事务之后：即使验收暂时失败，
批次也可能已经是 `PUBLISHED`，应重跑原失败任务完成验收，不要另建同版本批次。

完成条件是统一工作流成功，且 `hivecode-publication-<run-id>-<attempt>` artifact 中
`published.json` 记录正确来源、版本、构建号和全部选中项。直接下载文件会进行完整大小、
SHA-256、SHA-512 校验；iOS 使用 Apple 可分发性检查和商店链接核对。

CLI 参数参考：[触发工作流](https://cli.github.com/manual/gh_workflow_run)、
[重跑失败任务](https://cli.github.com/manual/gh_run_rerun)。
