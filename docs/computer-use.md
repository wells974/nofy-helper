# Computer Use 适配依据

参考项目：[chen0416ccc-cpu/codex-windows-fast-patch-skill](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill)，研究版本固定为 [`83d564dd9e9d429ca1a415cd9791fab9922e31c8`](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/tree/83d564dd9e9d429ca1a415cd9791fab9922e31c8)。依据其 `scripts/desktop-2611034239-profiles.json` 中的目标版本、特性编号、可用性字段以及安装器所描述的官方资源布局实现。

仓库未发现明确的开源许可证；nofy-helper 未复制或分发其安装器、PowerShell 脚本或补丁程序，也不在运行时下载执行这些文件。本项目独立使用 Acorn 实现识别与修改，使用本地官方 Codex 包提供的 CLI 和插件资源。

## 定向修改

| 位置 | 处理 |
| --- | --- |
| `webview/` 的可用性 IIFE | 根据核心具名参数、调用实参和状态值识别函数或箭头函数；保留原表达式求值，将三个指定功能参数置为真，保留用户启用、平台、加载、窗口类型及额外参数检查 |
| 同一渲染模块中的特性调用 | `1892382740` 结果置真，`337408568` 结果置假；要求同一模块内调用同一特性函数；保留原调用，其他特性不改 |
| `.vite/build/` 内启动模块（文件名可变化） | 根据 `NODE_REPL_TRUSTED_CODE_PATHS` 绑定及已有目录合并调用识别，在已有根目录后加入进程传入的可信目录；已原生继承时保留原逻辑 |
| ASAR 与 EXE | 重算成员／分块／头部 SHA-256，更新选定 Electron EXE 的内嵌摘要 |

版本号只用于记录和展示，不再作为准入条件。要求可用性参数、两处特性调用及可信目录模块都唯一匹配，且特性调用来自同一模块和同一函数。兼容参数表达式、静态字符串键、额外参数、压缩变量改名、直接／序列表达式调用和启动模块改名。零匹配、多匹配或不受支持的结构会给出具体检测原因，中文修复仍可独立使用。

原始观察来自 `26.1103.4239.0`。针对用户反馈的 `26.1103.32239` 以及更早／更晚的版本号增加合成样本回归，验证相同结构不受版本号阻挡。这些测试不等于取得或运行过对应的真实发行包；实际使用时仍逐项检测本机文件。

## 运行环境与恢复

工具检查副本 `resources/codex.exe`、`cua_node/bin/` 下的 Node／Node REPL／CUA REPL／Sky Windows 服务及 bundled 插件描述，与原始安装逐项对照。插件就绪依据为官方 CLI 返回的唯一 `computer-use@openai-bundled` 记录，要求 `installed: true` 且 `enabled: true`。插件文件诊断使用 CLI 返回的版本，检查默认缓存目录及 CLI 提供的本地 marketplace 源路径，比较描述文件的名称和版本，不要求 JSON 字节完全一致。缓存位置无法确认或插件版本与包内版本不同，仅作为兼容性提示，不推翻官方安装状态，也不触发重复安装。

使用 `shell: false` 启动副本自带且与原包一致的官方 CLI，传入实际 `CODEX_HOME`，沿用现有 marketplace 配置执行 `plugin list --marketplace openai-bundled --json` 和必要的 `plugin add`。不再用 `-c` 把 `openai-bundled` 来源替换为副本目录：上游安装器 `Get-ConfiguredBundledMarketplaceRoot` 明确记录，新版 CLI 只加载 Desktop 在 `.tmp/bundled-marketplaces/openai-bundled` 生成的保留来源，其他来源可能被静默忽略，造成“手动能看到插件、helper 却显示未安装”。

检查与启动共用解析后的绝对 `CODEX_HOME`，避免相对目录随子进程工作目录变化。Windows Worker 的环境变量读取区分大小写，而 Windows 子进程又会合并同名变量，因此读取时识别大小写变体、覆盖时删除旧变体；冲突的配置目录不静默选取。启动时移除会让 Electron 进入 Node 模式的继承变量，保留原有可信目录并设置 CUA 启动标志。CLI 的工作目录固定在其所在目录，避免继承 helper 启动项目的工作目录。

用户提供的 helper 日志在 2026-11-10 08:58:54（北京时间）记录了“清理失效 pipe 成功”后“CLI 插件命令失败”，不是完整准备成功。现在失败会显示退出码及经过常见凭据脱敏的 stderr，日志同时记录实际 `CODEX_HOME`，避免把来源不一致误报成插件未安装。此证据定位到准备流程缺陷，尚不能独立证明原生服务最终已成功启动。

准备前备份当前 `config.toml`，记录准备后的内容摘要和文件是否存在。重复尝试沿用首次备份；恢复前验证备份，并确认当前配置仍是本工具准备后的版本，避免覆盖用户之后的修改。插件缓存保留，应用文件恢复与配置恢复使用独立入口。Computer Use 未就绪不再禁用副本启动，允许进入 Codex 完成插件／Any App 设置；ASAR／EXE 指纹、官方应用更新和进程冲突仍会阻止不符合条件的启动。

新版本 Computer Use 可使用描述文件插件及独立 `cua_node` 运行时，统一 CUA 清单交由 Codex 原有代码生成；工具不伪造旧版 `computer-use-client.mjs` 或统一 MCP 清单。

## Native pipe unavailable / os error 2

依据同一上游提交的 [Computer Use Task Fails Before App Interaction](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/references/restriction-debug-cases.md#computer-use-task-fails-before-app-interaction)、[Computer Use Settings Says Plugin Unavailable](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/blob/83d564dd9e9d429ca1a415cd9791fab9922e31c8/references/restriction-debug-cases.md#computer-use-settings-says-plugin-unavailable)，以及安装器的 `Get-ComputerUsePipeConfigState` / `Update-CodexConfig` 行为实现本地配置修复，不新增 ASAR 或 EXE 补丁。

这个错误表示连接时没有找到目标原生管道，单凭错误文本无法区分旧地址、helper 缺失、桌面服务启动失败或退出。已安装插件和完整的包内文件都不足以证明管道已建立。

- “检查 Computer Use”解析 `config.toml` 中 `[mcp_servers.node_repl.env]` 的 `SKY_CUA_NATIVE_PIPE` 和 `SKY_CUA_NATIVE_PIPE_DIRECTORY`。与上游一致，通过 Windows `Test-Path -LiteralPath` 检查覆盖地址是否存在，不试连或伪造管道。
- “准备 Computer Use”在已有备份／恢复流程内，仅移除确认失效或不完整的两个覆盖项。活动地址保留；检查失败、TOML 无法解析或无法安全局部编辑时保留配置并给出原因。解析前后的完整文档对照保证其他配置不变，保留注释、换行和编码；不整份重写 TOML。
- 启动副本时，对继承的同名环境变量做同样检查。失效值仅从本次子进程环境移除，不改用户或系统环境变量，不保存动态 pipe 地址。
- 插件已经安装启用时，修 pipe 配置不会重复执行 `plugin add`。准备完成后必须完全重启副本并新建会话，旧进程和旧会话不会因此自动更新。
- 运行环境详情额外显示最近的 native pipe 启动与 Browser Use 可用性日志，注明文件时间及来源。历史 `startup ready` 不代表当前 pipe 存活；未找到日志也不视为通过。显示 `missing-helper-path` 时仍需确认当前运行时／缓存实际缺失项，本实现不盲目覆盖缓存。

界面“基础检查通过”只表示文件、所选组合的插件和 pipe 覆盖配置通过检查。选择“中文 + 电脑与浏览器”时还要求 browser、chrome 插件已安装且启用，准备时只调用 CLI 补齐缺失或未启用项；其他组合仍将其作为提示。Chrome 注册表、主机清单、schema 2 主机文件路径另列为诊断项，不修改注册表、不把历史日志视作当前连接成功。详见 [浏览器适配核对](browser-use.md)。

Windows 使用步骤：更新并重新打包 nofy-helper，退出 Codex，在现有副本上点击“检查 Computer Use”；若发现失效 pipe 配置，点击“准备 Computer Use”，然后从工具启动原副本，在新会话中验证。此修复不要求重新制作应用副本；若官方安装已更新，仍需按原有完整性规则重新创建。

## 验证边界

自动测试使用合成 ASAR／PE、模拟插件 CLI 和浏览器桥接；Electron 冒烟测试验证真实 Electron 文件系统与 Worker 检测。尚未在用户的实际 Windows 包上验证 CLI 注册、统一 CUA 清单生成、截图或输入。

新增回归覆盖 pipe 存在／缺失／未知状态、失效配置清理与精确恢复、活动配置保留、TOML 注释和多行字符串保护、启动环境隔离、Chrome 失效主机路径及历史日志判读。浏览器组合遇到重复的 browser／chrome 插件记录时停止准备，不把歧义当作未安装而重复注册。

所有 PowerShell 查询共用系统绝对路径和 UTF-8 输出，避免 Chrome 主机注册路径含中文时解码损坏。`tests/windows-integration.test.ts` 由现有 Windows CI 的 `npm run check` 自动运行：创建真实 named pipe，验证存在／关闭后的探测结果且不建立连接；验证包含中文、空格及特殊字符的路径原样返回。macOS 明确跳过这两项，不用模拟结果替代 Windows 验证。它们也不代替真实 Codex 的原生服务、Chrome 扩展和页面操作验收。

浏览器可用性适配通过独立组合选项启用。未引入参考项目的自定义模型、无关插件、全局环境变量、代理继承、Windows sandbox 配置或 Windows 10 原生截图二进制修改。

Chrome 与内置 Browser Use 的上游目标、当前缺口和日志诊断步骤见 [浏览器适配核对](browser-use.md)。Any App 已启用不能作为浏览器功能已修复的依据。

官方功能说明：[Computer Use](https://learn.chatgpt.com/docs/computer-use)。账户／地区、组织策略、插件开关与原生权限仍可能影响实际可用性。
