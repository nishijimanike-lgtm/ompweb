# 基于 Rust (Tauri v2) 的 ompweb 桌面版客户端设计方案

## 1. 概述与目标

本项目为 `ompweb`（Web 版 oh-my-pi 编码助手工作台）构建跨平台桌面版应用。应用以 Rust 语言作为宿主主进程（基于 Tauri v2 框架），无缝嵌入并托管原有的 Next.js 服务与现代 Web 前端，为用户提供低资源占用、原生体验的桌面运行环境。

## 2. 核心架构与职责划分

```
┌────────────────────────────────────────────────────────┐
│                   Tauri v2 (Rust 宿主)                 │
│  - 应用程序入口与单实例锁 (single-instance)             │
│  - 专属系统托盘控制器 (TrayIcon & Menu)                │
│  - 原生主窗口 (WebView2 / Wry)                         │
│  - 子进程守护监督器 (Child Process Supervisor)          │
└────────────┬─────────────────────────────┬─────────────┘
             │ 加载 URL                    │ 启动/管理/监控
             ▼                             ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│  WebView2 UI 视图层     │   │ Node.js ompweb Web 服务  │
│  http://127.0.0.1:30178 │   │ (Next.js App Router)     │
│  (Next.js React 19)     │   │ - RPC 管理器 (omp CLI)   │
│                         │   │ - Session JSONL 解析器   │
│                         │   │ - SSE 事件流通道         │
└─────────────────────────┘   └──────────────────────────┘
```

### 2.1 Rust 宿主进程 (src-tauri)
- **生命周期守护**：在客户端启动时，检测目标端口（如 `30178` 或 `30177`）是否已有运行中的 ompweb 实例；若无，则自动在后台启动 Node.js 服务并进行 HTTP 健康探测，就绪后加载页面。
- **退出与清理**：在客户端退出时，Rust 负责优雅发送中断信号（SIGINT / SIGTERM），确保与 [lib/rpc-manager.ts](file:///e:/github_nishi/ompweb/lib/rpc-manager.ts) 关联的 omp 子进程与 Node 进程安全退出，避免遗留僵尸后台进程。
- **单实例运行锁**：使用 `tauri-plugin-single-instance`，用户重复启动应用时直接聚焦现有客户端窗口。

### 2.2 Web 视图与服务进程
- 保留现有的 Next.js App Router 前端与服务端（SSE 流式推送、RPC 通信、工具调用等原生能力完整保留）。
- 客户端无缝使用 WebView2 渲染，享受全套前沿前端特性（React 19、Tailwind CSS、KaTeX、Mermaid 等）。

## 3. 专属系统托盘与窗口行为规范

### 3.1 托盘与 Web 自身托盘的区分
为了避免与既有的 Web 后台服务托盘（[scripts/windows/omp-web-tray.ps1](file:///e:/github_nishi/ompweb/scripts/windows/omp-web-tray.ps1)）混淆：
- **名称与提示 (Tooltip)**：
  - Web 版服务托盘名称：`omp-web Background Service`
  - **Desktop 桌面端托盘名称**：`omp-web Desktop`（提示文本：`ompweb Desktop (GUI)`）
- **托盘图标与配色**：
  - Web 版使用原版琥珀金/深色图标 [public/omp-web.ico](file:///e:/github_nishi/ompweb/public/omp-web.ico)。
  - **Desktop 桌面端制作专用配色图标**（例如采用高辨识度的青蓝/靛青渐变，或带有清晰桌面窗口边框徽记的 `src-tauri/icons/tray-desktop.ico`），在 Windows 任务栏通知区域一目了然。

### 3.2 窗口关闭与最小化策略
- **拦截关闭**：监听 `WindowEvent::CloseRequested` 事件，取消默认的窗口销毁动作，调用 `window.hide()` 隐藏至系统托盘，保证后台正在执行的代码生成或 Agent 任务不被意外中断。
- **单击托盘图标**：切换窗口显隐状态（若窗口隐藏/最小化则激活并置顶；若窗口处于前台则可快捷隐藏）。
- **右键托盘菜单**：
  - 显示 / 隐藏主窗口
  - 在默认浏览器中打开 (`http://127.0.0.1:<port>`)
  - 重启 ompweb 服务
  - 分隔线
  - 完全退出客户端

## 4. 目录结构与构建集成

```
ompweb/
├── src-tauri/
│   ├── Cargo.toml                 # Rust 依赖 (tauri v2, tauri-plugin-single-instance 等)
│   ├── tauri.conf.json            # 桌面客户端窗口尺寸、图标、权限与构建配置
│   ├── build.rs                   # Tauri 构建脚本
│   ├── icons/                     # Desktop 专属高对比度托盘与窗口图标
│   │   ├── icon.ico / icon.png
│   │   └── tray-desktop.ico       # 区别于 Web 的专用彩色托盘图标
│   └── src/
│       ├── main.rs                # 客户端入口：单实例、插件注册
│       ├── service_supervisor.rs  # 后台 Node.js 服务进程守护与健康探测
│       ├── tray.rs                # 专用托盘菜单生成、事件分发与显隐控制
│       └── window.rs              # 窗口事件监听（拦截 Close 隐藏到托盘）
```

### 4.1 npm 脚本扩展
- `npm run tauri:dev`: 同时拉起 Next.js dev 服务并在 Tauri 原生窗口中载入开发页面。
- `npm run tauri:build`: 生产编译，生成桌面可执行文件和安装包。

## 5. 错误恢复与容灾

- 若 Node 服务崩溃或端口暂时未响应，WebView2 会展示原生加载/重试提示屏，支持一键点击“重启服务”，并实时展示重试日志状态。
