# Computer Use 适配依据

参考项目：[chen0416ccc-cpu/codex-windows-fast-patch-skill](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill)，研究版本固定为 [`83d564dd9e9d429ca1a415cd9791fab9922e31c8`](https://github.com/chen0416ccc-cpu/codex-windows-fast-patch-skill/tree/83d564dd9e9d429ca1a415cd9791fab9922e31c8)。依据其 `scripts/desktop-2611034239-profiles.json` 中的目标版本、特性编号、可用性字段以及安装器所描述的官方资源布局实现。

仓库未发现明确的开源许可证；nofy-helper 未复制或分发其安装器、PowerShell 脚本或补丁程序，也不在运行时下载执行这些文件。本项目独立使用 Acorn 实现识别与修改，使用本地官方 Codex 包提供的 CLI 和插件资源。

## 定向修改

| 位置 | 处理 |
| --- | --- |
| `webview/` 的可用性 IIFE | 根据 9 个具名参数、调用实参和状态值识别；仅将三个指定功能参数置为真，保留用户启用、平台、加载、窗口类型检查 |
| 同一渲染模块中的特性调用 | `1892382740` 结果置真，`337408568` 结果置假；保留原调用，其他特性不改 |
| `.vite/build/early-bootstrap.js` | 根据 `NODE_REPL_TRUSTED_CODE_PATHS` 绑定及已有目录合并调用识别，在已有根目录后加入进程传入的可信目录 |
| ASAR 与 EXE | 重算成员／分块／头部 SHA-256，更新选定 Electron EXE 的内嵌摘要 |

仅接受版本 `26.1103.4239.0` 或 `26.1103.4239`，要求可用性参数、两处特性调用及可信目录位置都唯一匹配。零匹配、多匹配或不受支持的结构均停止组合修复，中文修复仍可独立使用。

## 运行环境与恢复

工具检查副本 `resources/codex.exe`、`cua_node/bin/` 下的 Node／Node REPL／CUA REPL／Sky Windows 服务及 bundled 插件描述，与原始安装逐项对照。使用 `shell: false` 启动官方 CLI，以进程内 `-c` 参数指定副本的本地 bundled marketplace，执行 `plugin list` 和必要的 `plugin add computer-use@openai-bundled`。

准备前备份当前 `config.toml`，记录准备后的内容摘要和文件是否存在。重复尝试沿用首次备份；恢复前验证备份，并确认当前配置仍是本工具准备后的版本，避免覆盖用户之后的修改。插件缓存保留，应用文件恢复与配置恢复使用独立入口。

新版本 Computer Use 可使用描述文件插件及独立 `cua_node` 运行时，统一 CUA 清单交由 Codex 原有代码生成；工具不伪造旧版 `computer-use-client.mjs` 或统一 MCP 清单。

## 验证边界

自动测试使用合成 ASAR／PE、模拟插件 CLI 和浏览器桥接；Electron 冒烟测试验证真实 Electron 文件系统与 Worker 检测。尚未在用户的实际 Windows 包上验证 CLI 注册、统一 CUA 清单生成、截图或输入。

未引入参考项目的自定义模型、其他插件、浏览器／Chrome 改动、全局环境变量、代理继承、Windows sandbox 配置或 Windows 10 原生截图二进制修改。

官方功能说明：[Computer Use](https://learn.chatgpt.com/docs/computer-use)。账户／地区、组织策略、插件开关与原生权限仍可能影响实际可用性。
