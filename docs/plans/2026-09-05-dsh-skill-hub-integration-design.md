# 技能中枢（dsh-skill-hub）集成设计方案

## 1. 项目背景与目标

为了提供比现有简单列表更强大、直观且体系化的技能管理体验，本项目计划将 [dsh-skill-hub](https://github.com/cheshireez/dsh-skill-hub)（技能中枢）的核心能力完整集成到 `ompweb` 的“设置”窗口中。

目标包括：
1. **统一技能视图**：全面覆盖用户全局技能目录（`C:\Users\zhang\.agents\skills`）、项目技能目录（`<project>/.agents/skills`）以及 omp 原生技能目录，支持平铺与来源分组折叠展示；
2. **场景与标签系统（Scenes）**：支持用户自定义场景（如论文写作、数据分析、代码工程等），一键批量启停特定场景下的技能集；
3. **技能市场与版本跟踪（Market）**：直接接入 GitHub 仓库源（如 `mattpocock/skills` 等），支持扫描、选择分支/Tag、异步导入技能，并支持检查更新和一键同步；
4. **诊断与一键修复（Diagnostics & Fix）**：自动检测本地技能 frontmatter 异常并提供一键修复；
5. **新建技能脚手架（Scaffold）**：提供规范的新建技能向导，快速创建标准化 SKILL.md。

---

## 2. 架构设计

### 2.1 设置导航层
- 在 `components/SettingsTabs.tsx` 中增加顶级分类 `skills`（“技能中枢” / “Skills Hub”）；
- 在 `components/SettingsConfig.tsx` 中，解绑此前与 `mcp` 的折叠绑定，将 `currentTab === "skills"` 指向全新的 `<SkillHubPanel />` 容器。

### 2.2 数据服务层（`lib/skill-hub/`）
- `skill-hub-service.ts`：本地多目录扫描（优先 `C:\Users\zhang\.agents\skills`）、frontmatter 深入解析、启停状态维护（兼容 `disable-model-invocation` 与 `.disabled` 机制）；
- `skill-hub-store.ts`：原子维护 `~/.omp/agent/skill-hub.json`，持久化场景标签配置、市场源与更新时间戳；
- `skill-hub-market.ts`：GitHub 仓库树扫描、技能文件多并发安全下载与进度推送；
- `skill-hub-diagnostics.ts`：frontmatter 格式体检与常见格式错误自动修复引擎。

### 2.3 后端 API 层（`app/api/skill-hub/[[...slug]]/route.ts`）
纯 Node.js / Next.js App Router 实现以下统一路由协议：
- `GET /api/skill-hub/catalog`：获取完整技能树、分组、已禁用列表与诊断项；
- `GET /api/skill-hub/skill`：获取特定技能详细元数据与 Markdown 正文；
- `POST /api/skill-hub/toggle` & `POST /api/skill-hub/toggle-batch`：单个或整组技能启停切换；
- `POST /api/skill-hub/create`：新建技能脚手架；
- `POST /api/skill-hub/diagnostic/fix`：一键修复异常技能文件；
- `GET/POST/DELETE /api/skill-hub/tag`：场景标签创建、更新、关联技能与删除；
- `GET/POST /api/skill-hub/market`：市场源检索、GitHub 仓库技能扫描与拉取导入；
- `GET/POST /api/skill-hub/sources`：检查上游更新与同步。

### 2.4 前端呈现层（`components/skill-hub/`）
- 移植 `dsh-skill-hub` 的 React 客户端组件：
  - `SkillHubPanel.tsx`：主控制台框架与视图路由；
  - `SourcesView.tsx`：多来源分组折叠卡片、三态开关与单技能开关；
  - `ScenesView.tsx`：场景标签管理工作台；
  - `MarketView.tsx`：GitHub 市场技能发现与导入器；
  - `SkillDetailView.tsx`：Markdown 详情预览与诊断修复；
  - `dialogs.tsx`：冲突确认、版本选择与导入确认弹窗；
- 样式适配：使用 ompweb 原生的 CSS Design Tokens，完美自适应深浅主题。

---

## 3. 安全性与可靠性设计
1. **根目录路径白名单**：写入操作仅限于用户全局技能根目录与当前项目技能根目录，严格校验非法跨目录路径；
2. **原子文件写入**：所有技能和配置修改均采用临时文件加原子重命名（temp + rename），杜绝掉电或中断导致文件损坏；
3. **网络优雅降级**：GitHub API 请求超时控制在 8 秒内，网络不可达时不阻塞本地技能的正常浏览与使用。
