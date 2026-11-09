# Chrome / Browser Use 上游核对

核对日期：2026-11-10。参考项目为 [codex-windows-fast-patch-skill](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill)，本次查询 GitHub 默认分支最新提交仍为 `83d564dd9e9d429ca1a415cd9791fab9922e31c8`，与现有 Computer Use 研究版本一致。

这是诊断与接入依据，不代表 nofy-helper 已实现浏览器修复。此次不修改应用功能判断、插件配置或注册表。

## 已确认的差距

上游的 [26.1103 配置](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/scripts/desktop-2611034239-profiles.json) 将以下目标分开处理：

| 上游目标 | 作用 | nofy-helper 当前情况 |
| --- | --- | --- |
| `computer-use`、`cua-runtime`、`cua-model-gate`、`trusted-paths` | Any App、CUA 运行时和可信资源目录 | 已参考接入 |
| `browser-external` | 外部 Chrome 可用性 | 未接入 |
| `browser-in-app` | 内置 Browser Use 可用性 | 未接入 |
| `browser-pane` | 内置浏览器面板能力 | 未接入 |
| `proxy-env` 及安装器的代理检查 | 子进程网络环境 | 未接入；是否需要取决于实际故障 |

用户提供的 CLI 输出已确认 `browser`、`chrome`、`unified-computer-use`、`computer-use` 已安装并启用，版本为 `26.1103.32239`。这只证明插件注册状态，不证明桌面可用性、扩展连接、网页导航或输入正常。截图中的 Any App 已开启也不能证明 Chrome 和内置浏览器可用。

Store 包版本 `26.1103.4239.0` 与包内版本 `26.1103.32239` 不能直接按字符串判定不兼容；后续适配应比较实际目标结构及运行资源。上游给出的文件摘要和代码片段是观察依据，不是所有未来版本的保证。

## 按上游顺序定位

依据上游 [Browser Use Or Chrome Still Shows Unavailable](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/references/restriction-debug-cases.md#browser-use-or-chrome-still-shows-unavailable)：

1. 先看 Electron 日志事件 `browser_use_availability_resolved` 的 `available` 和 `reason`。`statsig-disabled` 指向桌面功能判断；`local-patched` 只证明上游的可用性补丁生效，不证明浏览器连接成功。未找到事件时应记录未知，不能判定功能正常或未运行。
2. 只有桌面可用性已通过，才继续检查 Chrome 扩展、Native Messaging 清单及注册表、所选客户端与运行时资源。上游调用包内官方 `check-extension-installed.js` 和 `check-native-host-manifest.js`，不会把插件已启用当作扩展已连接。
3. 网页打开失败时进一步区分代理、目标站点网络与认证错误。上游的特定供应商认证修复有版本和配置前提，不能直接套用。
4. Chrome 与内置浏览器分别验证页面导航、可访问性读取、输入和点击。文件或配置检查通过不等于这些操作通过。

截图的“组织停用或地区不可用”是界面提示，尚不足以确定具体分支。不应仅凭这一提示强制修改功能判断。

## Windows 日志采集

先打开正在使用的修复副本，重现浏览器不可用提示，然后正常退出副本，让 Electron 刷新日志。在 PowerShell 中运行下列只读命令；它不修改配置、插件、注册表或安装文件。只输出相关事件，分享前仍应检查是否包含个人信息。

```powershell
$browserLogRoots = @(
  "$env:LOCALAPPDATA\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Codex\Logs",
  "$env:LOCALAPPDATA\Codex\Logs"
)
foreach ($browserLogRoot in $browserLogRoots) {
  if (Test-Path -LiteralPath $browserLogRoot) {
    Write-Output "Log root: $browserLogRoot"
    $browserLogs = @(Get-ChildItem -LiteralPath $browserLogRoot -Recurse -File -Filter '*.log' |
      Where-Object { $_.Length -gt 0 } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 12)
    foreach ($browserLog in $browserLogs) {
      Get-Content -LiteralPath $browserLog.FullName -Tail 4000 |
        Select-String -SimpleMatch 'browser_use_availability_resolved' |
        Select-Object @{Name='File'; Expression={$browserLog.FullName}}, Line
    }
  }
}
```

上游确认的路径是上述 Store 路径；第二项用于检查独立运行时的常见本地路径，尚未在用户副本上确认。采集仅覆盖每个目录最近 12 个非空日志的尾部；没有结果不表示没有故障，需要确认实际日志目录或扩大时间范围。检查时间和文件路径，避免将旧版或官方安装的日志当作当前副本结果。

## 接入边界

目前仅完成上游比对，没有浏览器补丁或 Windows 实机验收结果。下一步依据日志选择上游已经覆盖的修复分支，再对实际资源做匹配、备份与验证。保持现有独立副本与恢复机制，不将上游重装 MSIX 的整套安装流程直接套到 nofy-helper 副本上。

上游仓库未发现明确许可证；参考技术行为与诊断依据，不直接复制或分发其安装器。官方产品操作说明：[Chrome 扩展](https://learn.chatgpt.com/docs/chrome-extension)、[内置浏览器](https://learn.chatgpt.com/docs/browser)。
