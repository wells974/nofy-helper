# nofy-helper

nofy-api 的跨平台桌面辅助工具，基于 Electron + React + TypeScript，界面使用 shadcn/ui（Base UI）与 Tailwind CSS。首个工具针对 **Windows 10/11 x64 的 Codex / ChatGPT 桌面应用**：修复已选择中文、但内置翻译因 `enable_i18n` 关闭而不加载的问题。

中文修复只启用已有翻译，不制作翻译包，不配置 API、中转地址或账号。公共界面、搜索与外观设置可在 macOS 使用；当前中文修复能力限 Windows x64。各工具独立标注支持的平台。

现已加入可选的 **Computer Use 修复**，支持 Windows x64，并按实际代码结构判断兼容性，不再限制固定版本号。包括 `26.1103.32239` 在内的新旧版本，只要关键结构唯一匹配，就允许在独立副本中尝试修复。默认仍只修复中文；结构缺失或存在歧义时显示具体原因。

## 品牌资源

复用 nofy-api 的 NofyAI 品牌：珊瑚橙、暖白与炭灰主题，以及官方亮色／深色 Logo 和图标。资源存放于 `assets/branding/`，来源见该目录 README；界面与浏览器页签使用原始资源；Electron 窗口、Dock 和 Windows / macOS / Linux 打包使用原标识加暖白圆角底板的应用图标。产品名称保持 `nofy-helper`。

## 开发与打包

需要 Node.js 22.12 或以上版本、npm。

```sh
npm install
npm run dev
npm run check
npm run smoke
npm run dist:win
```

macOS 上的 `npm run dev` 会使用已安装的 Electron 运行时，在 `work/desktop/` 生成带有产品名称和图标的本地 `.app`，然后启动它。这样 Dock、菜单栏和系统中的名称均为 `nofy-helper`。本地预览只做临时签名，不发布、不公证；Windows 和 Linux 继续直接启动 Electron。修改代码后退出预览并重新运行该命令即可。

`npm install` 会通过 Electron 官方安装器获取开发运行时。首次安装和打包需要网络；生成的工具对本地应用执行检测与修复时无需下载脚本或依赖。`npm run pack:win` 只输出 Windows 解包目录；`npm run dist:win` 输出 NSIS 安装包。建议在目标系统上打包；仓库提供 Windows 验证和多平台 Release 工作流。安装包暂未配置发布者签名。

## GitHub 自动发布

仓库：`https://github.com/wells974/nofy-helper`。`.github/workflows/release.yml` 在推送 `v*` 标签时执行版本校验、四路构建，全部通过后发布 GitHub Release。Windows 验证工作流仅由 PR 事件或手动运行触发；直接推送 `main` 不触发工作流。

| 构建任务 | 安装包 |
| --- | --- |
| Windows x64 | `nofy-helper-版本-x64-setup.exe` |
| macOS Apple Silicon | `nofy-helper-版本-mac-arm64.dmg`、`.zip` |
| macOS Intel | `nofy-helper-版本-mac-x64.dmg`、`.zip` |
| Linux x64 | `nofy-helper-版本-linux-x64.AppImage`、`.tar.gz` |

发布前必须收齐七个非空安装包，并生成 `SHA256SUMS.txt`。任何构建失败都不会发布；上传期间保持草稿，全部上传成功后才公开。重跑可以恢复草稿，但不会覆盖已经公开的同版本 Release。带 `-beta.1` 等后缀的版本标记为预发布。

首次发布：

1. 将本次工作流、脚本、测试和 package.json 变更提交并推送到 `main`。
2. 打开仓库 **Actions → Release → Run workflow**，选择 `main` 手动试跑。手动运行只生成可下载 Artifacts，不创建 Release。
3. 四路试跑通过后，确认 `package.json`、`package-lock.json` 都是 `0.1.0`，再执行：

```sh
git tag v0.1.0
git push origin v0.1.0
```

后续更新先用 `npm version 0.1.1 --no-git-tag-version` 同步两个版本文件，提交并推送代码后再创建、推送 `v0.1.1`。标签必须与两个文件的版本完全一致；推送不匹配的标签会在打包前失败。

此工作流使用 GitHub 托管的构建机，不需要自己的构建机或个人 Token。只有发布任务授予 `contents: write`；如果组织策略限制 Actions 写入，需要管理员允许该仓库发布 Release。下载地址：`https://github.com/wells974/nofy-helper/releases`。

当前 CI 生成的是 Windows 未签名包、macOS 临时签名且未公证包。后续有发布证书时再接入 Secrets 和签名／公证；当前配置未提供自动更新功能。各系统安装包不代表修复功能跨平台，中文修复依然仅支持 Windows x64。

## 使用流程

1. 完全退出 Codex / ChatGPT，包括托盘和相关命令行进程。
2. 从自动发现的安装中选择一个，或手动选择安装目录。也支持填写 EXE 路径、Microsoft Store 包目录。
3. 点击“检测安装”。这一步只读：检查包身份、中文资源、唯一的翻译开关位置和 EXE / ASAR 完整性信息。
4. 检测成功后点击“创建修复副本”，阅读目标和签名变更提示。工具会在自身用户数据目录创建独立副本，备份原文件并应用补丁。
5. 点击“启动副本”，在 Codex 的 Language 中选择简体中文。请检查设置、侧栏和菜单，并进行退出后重新启动及离线启动验证。创建成功不等于已确认界面修复。
6. “恢复”将副本的 ASAR 和 EXE 从备份还原；官方安装始终未被修改，随后可使用原来的官方入口。

副本使用应用原有的用户配置和工作内容，因此不能与官方应用同时运行。若官方安装或副本被更新，启动校验会阻止使用过期副本；重新检测官方安装、创建新副本即可。工具不关闭更新服务，也不会自动强杀进程。

Windows 自动查找会读取 Microsoft Store 包信息、当前用户及系统注册表中的安装位置和 App Paths，并检查常见本地目录。支持包根目录、`app` / `bin` 子目录及 `app-版本号` 目录；同一安装只显示一次。Store 查询失败时会继续检查可读的 `WindowsApps` 目录，不需要修改权限。若仍未找到，可手动填写 EXE 路径；查询失败原因可在设置中的日志入口查看。

## Computer Use

1. 完全退出 Codex，检测官方安装。出现“关键代码结构匹配，可尝试修复”后，选择“中文 + Computer Use”；需要 Chrome 和内置 Browser Use 时选择检测通过的“中文 + 电脑与浏览器”，再创建新副本。已有副本不会自动升级为新的组合。
2. 点击“检查 Computer Use”查看运行文件与插件状态，再点击“准备 Computer Use”。工具核对副本与原始安装中的 CLI、Node REPL、CUA 运行文件及插件描述，调用副本自带的官方 CLI 安装并启用 `computer-use@openai-bundled`，读取官方 CLI 的安装／启用状态，并单独显示插件版本与文件布局诊断。
3. 从本工具启动副本。Computer Use 尚未就绪也可进入应用完成设置；“基础检查通过”只表示文件、所选插件和 pipe 覆盖配置通过检查。在 Codex 的 Computer Use 设置里开启 **Any App**，新建会话测试截图和简单窗口操作。浏览器组合还需分别验证 Chrome 和内置 Browser Use，首次使用 Chrome 需完成官方扩展设置。每次启动都会尝试重新检查；插件检查失败会显示提示，不会禁用整个副本的启动。应用文件完整性、更新与进程冲突校验仍生效。静态检测通过不等于真实操作已成功。
4. 回退时先退出 Codex。“恢复 Computer Use 配置”恢复准备前的配置；“恢复”单独恢复副本应用文件。需要完整回退时分别执行这两个操作。

准备操作会读取并备份 `CODEX_HOME/config.toml`（未指定 `CODEX_HOME` 时为用户目录下 `.codex/config.toml`），通过官方 CLI 修改插件配置，创建插件缓存。备份位于该修复记录的 `cua-config/`，界面可展开查看路径；其中可能包含原配置中的敏感信息，应与个人配置同样保管。失败重试保留首次备份；准备后用户又修改了配置时，自动恢复会拒绝覆盖，并给出原备份位置。恢复保留插件缓存及备份。

启动所需的 `CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE` 和可信代码目录仅传给副本进程；补丁保留运行时已有可信目录并继承这些路径。CLI 沿用现有 bundled marketplace，浏览器组合仅补齐缺失或未启用的 browser／chrome 插件。工具不写全局环境变量，不修改 API 地址、账号、模型列表或无关插件。包内运行文件缺失时停止准备，不下载或执行社区脚本。Computer Use 使用 Windows 当前桌面；原生权限、账户可用性和组织策略仍由 Codex 控制。

结构匹配表示可以生成定向补丁，不代表该版本已完成实机验收。此适配尚未在真实 Windows 安装上完成截图／输入验收，也未移植参考项目的 Windows 10 原生截图二进制补丁、Chrome 配置或代理环境扩展。相关场景仍需实机验证。实现依据与范围见 [Computer Use 适配说明](docs/computer-use.md)。

## 修复策略

- 使用 Acorn 解析 JavaScript AST，不使用全局字符串替换。
- 只在 `webview/` 内识别具有 `72216192`、`localeOverride`、`messages` 上下文的 `get("enable_i18n", false/!1)`。
- 必须恰好匹配一个位置；零匹配或多匹配均拒绝修改。只支持当前识别的结构，不承诺未来版本。
- 将完整 getter 表达式（包含可选链）替换为等字节长度的 `true`。这样既处理远端键缺失，也处理对象缺失和显式 `false`。其他实验开关、语言选择逻辑和翻译文本不变。
- 组合修复额外定向处理 Computer Use 可用性参数、运行时和模型门控，并保留原特性调用及平台、加载、窗口类型、用户启用检查；同时补上 Node REPL 可信目录继承。长度增长的成员追加到 ASAR 数据尾部，重建头部与完整性摘要，其他成员内容及 unpacked 文件保留。
- 中文资源检测支持显式命名的 zh-CN/zh-Hans 文件；数字文件名则要求实际中文文本、关键界面词条及至少 100 段中文内容。后者是静态证据，最终效果仍须实际界面验收。
- 更新修改文件的 SHA-256 / 分块摘要和 ASAR 头摘要。精确定位 PE 中 `INTEGRITY / ELECTRONASAR` 资源，只更新该资源的 64 字节摘要。不会关闭完整性校验或修改 Electron fuse。
- 官方安装完整复制后才在暂存目录修改；完成校验后一次性发布目录。错误会清理未发布的暂存副本。进程崩溃留下的 `.staging-*` 目录不会出现在可启动列表，可在退出工具后手工删除。
- 备份保留在每份修复记录的 `originals/`，不会被重复安装覆盖。恢复前记录 `restoring` 状态，中断后禁止启动，可以再次恢复。

## 边界和限制

- 修改 EXE 的任何字节都会使 OpenAI 原始 Authenticode 签名失效。工具会明确提示；它不关闭 SmartScreen、杀毒软件或企业策略，也不请求用户这样做。
- 在 `Codex.exe` / `ChatGPT.exe` 中选择唯一一个内嵌 ASAR 哈希与资源包一致的程序，兼容两者同时存在的安装目录；不匹配或有多个匹配时停止。要求 PE32+ x64、唯一内嵌 ASAR 完整性资源、内嵌 JS 及有效分块摘要。不支持 ARM、特殊重打包、符号链接/目录联接和未知结构。
- 原始包可以来自 Microsoft Store，但复制版的启动行为必须在目标版本实测；某些依赖包身份、更新器或原签名的功能可能不适用于副本。
- 磁盘检查预留两倍安装目录大小加 256 MiB。日志只记录进度与错误，不读取 API 密钥或会话内容。
- 目前未在真实 Windows Codex 安装上完成端到端验收，不能据自动测试声称所有目标版本修复成功。

## 验证

自动测试覆盖：三个开关失败分支、可选链、真假默认值区分、Unicode/换行、重复匹配拒绝、官方 ASAR 工具互操作、PE 字节范围、创建/启动校验/恢复、更新失效、备份损坏、恢复中断、进程竞争、路径与链接拒绝。测试均使用合成应用，不触碰本机 Codex。

Computer Use 测试还覆盖组合补丁及共用成员、运行时调用保留、可信目录继承、ASAR 成员增长、跨版本结构兼容、表达式／箭头函数／启动文件改名适配、原生可信目录继承保留、缺失或歧义结构拒绝、CLI 安装状态／本地 marketplace 路径／描述文件格式差异的兼容与运行文件校验、配置逐字节恢复、准备失败重试、原配置不存在及用户后续修改保护。插件 CLI 通过可注入模拟器验证，真实 Windows CLI 注册和桌面操作仍需人工验收。

`npm run smoke` 额外在真正的 Electron 运行时验证：主进程保持 ASAR 虚拟文件系统启用时，安装查找仍能通过原始文件系统识别资源包；后台 Worker 对合成应用完成只读检测，验证 ASAR 原始字节读取与完整性校验。

Windows 发布前仍需逐项人工验证：普通安装、Microsoft Store 安装、中文路径、离线启动、主界面真实汉化、账户/原生功能、应用更新后的拒绝启动、恢复后原版正常启动。

## 目录

```text
src/core/     纯 Node 修复引擎（AST / ASAR / PE / 生命周期）
src/main.ts   Electron 主进程、IPC、操作确认
src/backend.ts / worker.ts 后台修复进程，避免解析大文件阻塞窗口
src/preload.ts 最小化桥接
src/windows.ts Windows 安装发现与进程检测
src/renderer.tsx / index.html / styles.css 渲染入口与主题
src/app/      公共外壳、工具注册与外观设置
src/features/ 各工具页面和状态逻辑
src/components/ui/ shadcn/ui 组件源码
tests/        合成样本和故障路径
```

## 参考

- [Codex 国际化开关问题](https://github.com/openai/codex/issues/24741)
- [启动网络条件与界面语言](https://github.com/openai/codex/issues/52471)
- [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [Electron Packager 的 Windows 完整性资源实现](https://github.com/electron/packager/blob/main/src/resedit.ts)

nofy-helper 是独立工具，与 OpenAI 无隶属关系。

## 界面开发与验证

采用 A 方向：侧栏工作台。直接进入当前工具，搜索支持 `Cmd/Ctrl + K`，侧栏支持收起；设置提供浅色、深色与跟随系统。主题保存在本机，存储失败会提示并保留上一个设置。

`src/app/tools.ts` 注册真实工具入口；后续工具在 `src/features/` 中扩展。工具数量不足时不显示空分类。

```sh
npm run ui:preview
# 另一个终端，需要本机已安装 Chrome：
npm run test:ui
```

预览仅监听 `127.0.0.1:4318`，使用独立的 `tests/ui-fixture.ts` 模拟桥接，可通过 `?state=mac` 查看不支持平台状态。模拟文件只在 `work/` 下编译，不包含在发布包中。测试覆盖检测、路径变更、失败保留输入、创建/启动/恢复、重新读取记录、搜索、主题保存失败、缩放与平台限制，连续运行三轮；模拟测试不代表真实 Windows 修复验收。

`npm run ui:prepare` 只编译渲染层，方便配合既有 Electron 开发输出查看；完整开发启动仍使用 `npm run dev`。

设计方向、官方参考图与实际验收截图位于 `work/design/`。`release/` 是本地产物目录；对外发布以通过 GitHub Release 工作流生成的版本为准。
