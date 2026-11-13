# Chrome / Browser Use 上游核对

核对日期：2026-11-10。参考项目为 [codex-windows-fast-patch-skill](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill)，本次查询 GitHub 默认分支最新提交仍为 `83d564dd9e9d429ca1a415cd9791fab9922e31c8`，与现有 Computer Use 研究版本一致。

这是适配与诊断依据，不代表已完成 Windows 浏览器实机验收。通过“中文 + 电脑与浏览器”创建新副本时，应用以下浏览器可用性适配；同时提供浏览器插件、Chrome 主机注册及路径、桌面连接日志检查。注册表由 Codex 的官方扩展设置流程管理。

## 适配范围

上游的 [26.1103 配置](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/scripts/desktop-2611034239-profiles.json) 将以下目标分开处理：

| 上游目标 | 作用 | nofy-helper 当前情况 |
| --- | --- | --- |
| `computer-use`、`cua-runtime`、`cua-model-gate`、`trusted-paths` | Any App、CUA 运行时和可信资源目录 | 已参考接入 |
| `browser-external` | 外部 Chrome 可用性 | 新浏览器组合接入 |
| `browser-in-app` | 内置 Browser Use 可用性 | 新浏览器组合接入 |
| `browser-pane` | 内置浏览器面板能力 | 新浏览器组合接入 |
| `proxy-env` 及安装器的代理检查 | 子进程网络环境 | 未接入；是否需要取决于实际故障 |

用户提供的 CLI 输出已确认 `browser`、`chrome`、`unified-computer-use`、`computer-use` 已安装并启用，版本为 `26.1103.32239`。这只证明插件注册状态，不证明桌面可用性、扩展连接、网页导航或输入正常。截图中的 Any App 已开启也不能证明 Chrome 和内置浏览器可用。

Store 包版本 `26.1103.4239.0` 与包内版本 `26.1103.32239` 不能直接按字符串判定不兼容；后续适配应比较实际目标结构及运行资源。上游给出的文件摘要和代码片段是观察依据，不是所有未来版本的保证。

实现使用 Acorn 按上游观察到的 IIFE 具名参数、状态值及 `browser.in-app` 能力读取定位，不硬编码版本、压缩变量或文件名。Chrome 的三个可用性参数、内置 Browser Use 的三个可用性参数及一个面板能力读取必须分别唯一匹配；不满足时仅禁用浏览器组合，中文与 Computer Use 仍独立检测。保留特性表达式求值、加载／WSL／窗口判断、`isBrowserEnabled` 及函数外原有的启用条件，不照搬上游整体替换可用性函数的写法。没有新增主进程或原生二进制改动；更老布局需要额外 sender/receiver 适配时不应视为本实现已覆盖。

面板定位要求所在 JS 成员包含唯一的 `1892382740` 与 `337408568` 特性调用，两者使用同一 hook，且与目标能力读取位于同一函数作用域（顶层声明使用模块作用域）。打包后的同一成员可能同时包含链接打开、会话迁移与桌面功能发布逻辑，不能将整个成员中的能力读取全部计入目标。2026-11-13 在本机应用包中确认了这种三处读取的布局：只有桌面功能发布函数中的读取与两个 CUA 特性调用同作用域。其他函数及嵌套回调内的读取保持原样；同一目标作用域内仍要求读取唯一。回归覆盖跨成员 29 处读取、同成员三处读取的精确修改与恢复、不同作用域的 CUA 调用拒绝，以及同作用域多匹配拒绝。不依赖版本号、文件名或压缩变量名。

中文、Computer Use 和浏览器修改可能位于同一 JS 成员，组合时对已修改内容重新解析偏移，再统一重建 ASAR 和 EXE 完整性；恢复仍使用原始备份。旧记录没有 `browserUse` 标记时明确视为未包含浏览器适配，更新 helper 不会自动改写旧副本。

使用步骤：完全退出 Codex，重新检测官方安装，选择“中文 + 电脑与浏览器”并创建新副本；点击“准备 Computer Use”补齐所选组合所需的 computer-use、browser、chrome 插件，已启用的不重复安装。启动新副本后在 Codex 完成 Chrome 扩展安装，并分别用新会话验证 Chrome、内置浏览器和 Any App。

## 按上游顺序定位

依据上游 [Browser Use Or Chrome Still Shows Unavailable](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/references/restriction-debug-cases.md#browser-use-or-chrome-still-shows-unavailable)：

1. 先看 Electron 日志事件 `browser_use_availability_resolved` 的 `available` 和 `reason`。`statsig-disabled` 指向桌面功能判断；`local-patched` 只证明上游的可用性补丁生效，不证明浏览器连接成功。未找到事件时应记录未知，不能判定功能正常或未运行。
2. 只有桌面可用性已通过，才继续检查 Chrome 扩展、Native Messaging 清单及注册表、所选客户端与运行时资源。上游调用包内官方 `check-extension-installed.js` 和 `check-native-host-manifest.js`，不会把插件已启用当作扩展已连接。
3. 网页打开失败时进一步区分代理、目标站点网络与认证错误。上游的特定供应商认证修复有版本和配置前提，不能直接套用。
4. Chrome 与内置浏览器分别验证页面导航、可访问性读取、输入和点击。文件或配置检查通过不等于这些操作通过。

截图的“组织停用或地区不可用”是界面提示，尚不足以确定具体分支；本实现依据上游公开的三个目标结构生成定向补丁，不把截图文案当作实际连接成功或服务端权限已满足的证据。

## Windows 日志采集

更新 nofy-helper 后，可优先在现有副本上点击“检查 Computer Use”并展开“运行环境详情”：这里会同时显示 native pipe 配置、Chrome／Browser 插件、当前用户 Chrome Native Messaging 注册、主机清单与路径记录，以及两类桌面日志。浏览器诊断是提示项，不阻止副本启动。它尚未执行扩展的动态连接测试，也没有检查所有注册表范围或 Edge。

Any App 的 `SKY_CUA_NATIVE_PIPE_DIRECTORY` 与 Chrome Native Messaging 是不同连接入口，不能因为 Any App 报 `os error 2` 就认定浏览器也有同样的 pipe 故障。Chrome 仍可能因为主机／客户端路径失效而无法连接；内置 Browser Use 也有独立的可用性和运行服务。检查中的文件存在、插件启用或历史日志都不构成网页操作验收。

先打开正在使用的修复副本，重现浏览器不可用提示，然后正常退出副本，让 Electron 刷新日志。在 PowerShell 中运行下列只读命令；它不修改配置、插件、注册表或安装文件。只输出相关事件，分享前仍应检查是否包含个人信息。

```powershell
$browserLogRoots = @(
  "$env:LOCALAPPDATA\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Codex\Logs",
  "$env:LOCALAPPDATA\Codex\Logs",
  "$env:APPDATA\Codex\logs",
  "$env:APPDATA\ChatGPT\logs"
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

上游确认的路径是上述 Store 路径；其他项是独立运行及 Electron 的候选日志位置，尚未在用户副本上确认。命令只读取各目录最近 12 个非空日志的尾部；工具内诊断对所有候选合计读取最新 12 个，并报告发现文件数与目录。没有结果不表示没有故障，需要确认实际日志目录或扩大时间范围。检查时间和文件路径，避免将旧版或官方安装的日志当作当前副本结果。

## 接入边界

当前已实现上述浏览器可用性组合补丁及连接前置诊断。自动测试覆盖组合修改／恢复、同一成员内多种补丁、WSL／加载／用户启用条件及模糊结构拒绝；尚无用户实际 Windows 包上的 Chrome 导航、内置浏览器操作或原生 pipe 连接验收结果。保留现有独立副本与恢复机制，不将上游重装 MSIX 的整套安装流程直接套到 nofy-helper 副本上。

上游仓库未发现明确许可证；参考技术行为与诊断依据，不直接复制或分发其安装器。官方产品操作说明：[Chrome 扩展](https://learn.chatgpt.com/docs/chrome-extension)、[内置浏览器](https://learn.chatgpt.com/docs/browser)。
