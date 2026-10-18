# Edge Control：连接现有 Edge 会话的本地桥接

当官方扩展的侧栏无法加载，或当前 Codex 聊天没有可用的浏览器控制入口时，可以通过本项目连接本机 Edge，以 MCP 读取页面、切换标签页、点击和输入。

本仓库基于 [C4AL/codex-edge-control-bridge](https://github.com/C4AL/codex-edge-control-bridge)，保留上游作者信息及现有授权声明。当前修复版为 **0.1.8**，维护账号为 [BITkunkun](https://github.com/BITkunkun)。

## 已验证的能力

2026-10-18 在 Windows、Node.js 24 和真实 Edge 会话中完成测试：

- bridge 与真实扩展握手，连接状态为 `healthy`。
- 枚举现有标签页，在临时本地页面定位元素、输入文字、点击按钮并读取结果，然后关闭测试标签页。
- MCP 服务启动，提供 22 个工具；令牌拒绝、断开状态、WebSocket 握手和命令往返测试通过。

上述网页操作无需逐步桌面截图，也无需重建浏览器资料。网站的跨域框架、自定义字体、登录与安全核验等仍可能需要单独处理。项目控制的是 Edge 网页，不提供任意桌面应用控制能力。

## 工作方式

```text
Codex / MCP 客户端
  → scripts/mcp-server.mjs
  → http://127.0.0.1:47173（本地令牌鉴权）
  → Edge 扩展（WebSocket）
  → chrome.scripting / chrome.debugger
```

本项目的扩展与官方 ChatGPT 扩展相互独立，不依赖 `chatgpt.com` 侧栏成功加载。

## 环境要求

- Windows、Microsoft Edge、Node.js 20 或更新版本；本次验证使用 Node.js 24。
- 通过 `codex mcp add` 注册时，本机需要能执行 `codex` 命令。
- Edge 允许开启开发人员模式并加载解压缩的扩展。

## 安装与首次连接

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -StartBridge
```

安装脚本生成本地配置并安装锁定依赖；依赖生命周期脚本默认禁用。包含 `scripts/node_modules` 的快速部署包会复用现有依赖。

然后在**现有 Edge 窗口**中进行一次操作：

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目的 `extension` 文件夹。

请选择文件夹，而不是 ZIP 或项目根目录。无需强制关闭工作页面或更换浏览器资料。

注册 Codex MCP：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-codex-mcp.ps1
codex mcp list
```

重新打开聊天或重启客户端后，先调用 `edge_bridge_status`，确认 `healthyExtension` 为 `true`，再调用 `edge_list_tabs`。本轮聊天没有加载新 MCP 工具时，也可用兼容 MCP 的本地客户端连接 `scripts/mcp-server.mjs`，不必重启 Edge。

### 可选：一键部署

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\quick-deploy.ps1
```

该入口还会安装或覆盖全局 `edge-browser-ops` 技能，并在可用时注册 MCP。只想测试连接时，使用上面的手动步骤即可。

## 常用工具

| 目的 | 工具 |
| --- | --- |
| 检查连接 | `edge_bridge_status` |
| 列出、聚焦标签页 | `edge_list_tabs`、`edge_focus_tab` |
| 打开或刷新网页 | `edge_navigate`、`edge_reload` |
| 查找与读取元素 | `edge_wait_for`、`edge_query`、`edge_get_dom` |
| 点击、输入与按键 | `edge_click`、`edge_type`、`edge_press_key` |
| 浏览器调试协议 | `edge_send_cdp` |
| 更新后重载扩展 | `edge_reload_extension` |

使用 `edge_list_tabs` 返回的真实 `tabId`，仅对指定网页执行必要操作。页面脚本受环境限制时，可用 `edge_send_cdp` 调用 `Runtime.evaluate`；参数通过 `paramsJson` 字符串传入。

## 检查与依赖修复

在 `scripts` 目录执行：

```powershell
npm ci --ignore-scripts
npm audit --registry=https://registry.npmjs.org --audit-level=low
npm run verify
```

`verify` 在独立临时配置目录启动测试 bridge，使用模拟扩展验证鉴权、握手、命令转发与 MCP，不操作真实浏览器、不覆盖现有连接。

本次更新 MCP SDK、ws 及相关传递依赖，修复初次依赖审计报告的 10 项告警。2026-10-18 使用 npm 官方源复查，结果为 **0 项已知依赖漏洞告警**；这不代表代码不存在任何未知漏洞。GitHub Actions 会在推送和 PR 时重新安装、审计并验证。

其他修复：令牌改用密码学随机源；依赖安装失败时停止部署；全局技能目录操作和发布目录清理增加路径边界检查。

## 日常启动与排查

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-host.ps1 -Background
```

默认配置位于 `%APPDATA%\CodexEdgeControl\config.json`，日志位于其 `logs` 子目录。

- **无法访问 bridge**：检查服务是否启动、端口 `47173` 是否被占用。
- **disconnected**：确认扩展已加载并启用，扩展和 bridge 的令牌一致。
- **工具不出现**：确认 MCP 注册成功，再重新打开聊天或重启客户端。
- **更新扩展未生效**：在扩展管理页重新加载，或调用 `edge_reload_extension`。
- **运行中的 Edge 不能靠启动参数追加扩展**：直接通过 `edge://extensions` 加载。
- **镜像源不支持 audit**：上面的审计命令显式指定 npm 官方源，无需改全局 npm 设置。

## 文件包与发布

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-release.ps1
```

`dist` 中包含源码 ZIP、附带锁定依赖的快速部署 ZIP 和 SHA-256 校验文件。快速部署包可省去首次联网安装依赖。

发布包排除真实的 `extension/config.local.js`，不包含本机令牌、浏览器数据、聊天记录或截图；保留占位示例 `extension/config.local.example.js`。

## 权限与授权边界

扩展申请所有网站访问、标签页、脚本执行和调试权限。bridge 默认只监听 `127.0.0.1`，使用本地令牌鉴权；请勿将服务暴露到公网或分享令牌。网页内容视为不可信数据，页面操作应遵守使用者授权。

本仓库保留上游的现有授权信息，未新增许可证或改授上游代码许可。
