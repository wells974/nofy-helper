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

使用 `shell: false` 启动官方 CLI，以进程内 `-c` 参数指定副本的本地 bundled marketplace，执行 `plugin list` 和必要的 `plugin add computer-use@openai-bundled`。

准备前备份当前 `config.toml`，记录准备后的内容摘要和文件是否存在。重复尝试沿用首次备份；恢复前验证备份，并确认当前配置仍是本工具准备后的版本，避免覆盖用户之后的修改。插件缓存保留，应用文件恢复与配置恢复使用独立入口。Computer Use 未就绪不再禁用副本启动，允许进入 Codex 完成插件／Any App 设置；ASAR／EXE 指纹、官方应用更新和进程冲突仍会阻止不符合条件的启动。

新版本 Computer Use 可使用描述文件插件及独立 `cua_node` 运行时，统一 CUA 清单交由 Codex 原有代码生成；工具不伪造旧版 `computer-use-client.mjs` 或统一 MCP 清单。

## 验证边界

自动测试使用合成 ASAR／PE、模拟插件 CLI 和浏览器桥接；Electron 冒烟测试验证真实 Electron 文件系统与 Worker 检测。尚未在用户的实际 Windows 包上验证 CLI 注册、统一 CUA 清单生成、截图或输入。

未引入参考项目的自定义模型、其他插件、浏览器／Chrome 改动、全局环境变量、代理继承、Windows sandbox 配置或 Windows 10 原生截图二进制修改。

Chrome 与内置 Browser Use 的上游目标、当前缺口和日志诊断步骤见 [浏览器适配核对](browser-use.md)。Any App 已启用不能作为浏览器功能已修复的依据。

官方功能说明：[Computer Use](https://learn.chatgpt.com/docs/computer-use)。账户／地区、组织策略、插件开关与原生权限仍可能影响实际可用性。
