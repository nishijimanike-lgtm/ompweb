# 技能中枢（dsh-skill-hub）集成实施计划

将 [dsh-skill-hub](https://github.com/cheshireez/dsh-skill-hub)（技能中枢）完整集成到 `ompweb` 的设置功能中，为用户提供功能强大的本地技能目录管理（支持 `C:\Users\zhang\.agents\skills` 全局技能与项目技能）、多来源分组与三态开关、场景标签批量管理、GitHub 技能市场拉取与版本更新追踪、以及技能正文预览与格式诊断一键修复功能。

## User Review Required

> [!IMPORTANT]
> - **全局技能目录主路径**：将按照用户规则优先绑定 `C:\Users\zhang\.agents\skills` 作为核心用户级技能存放与安装目录，同时兼顾项目工作区 `.agents/skills` 与 `~/.omp/agent/skills`。
> - **设置导航项调整**：在设置左侧导航栏中，将“技能”提拔为与“通用”、“模型”同级的独立导航项【技能中枢】，图标使用专业技能中枢图标。

## Open Questions

暂无。核心需求与架构已在 Brainstorming 阶段完成探讨与对齐。

---

## Proposed Changes

### 后端数据服务与 API 层 (`lib/skill-hub/` & `app/api/skill-hub/`)

#### [NEW] [protocol.ts](file:///d:/github_nishi/ompweb/lib/skill-hub/protocol.ts)
- 定义统一的数据契约：`CatalogSkill`、`CatalogResponse`、`SkillDetail`、`SkillTag`、`MarketSource`、`DiagnosticEntry` 等类型与常量；
- 支持中英文元数据字段兼容与序列化。

#### [NEW] [skill-hub-store.ts](file:///d:/github_nishi/ompweb/lib/skill-hub/skill-hub-store.ts)
- 实现对 `~/.omp/agent/skill-hub.json` 的原子持久化存取（带有锁和临时文件重命名机制）；
- 保存场景标签（Tags / Scenes）、自定义市场源（Market Sources）、安装与更新版本快照（Tracked Sources）、禁用技能列表。

#### [NEW] [skill-hub-service.ts](file:///d:/github_nishi/ompweb/lib/skill-hub/skill-hub-service.ts)
- 扫描本地多根目录（`C:\Users\zhang\.agents\skills`、项目目录、用户 omp 目录）；
- 提取 frontmatter 元数据（name, description, whenToUse, disabled 等）；
- 实现技能启用/禁用切换逻辑（兼容修改 frontmatter `disable-model-invocation` 与 `.disabled` 安全更名方式）；
- 提供新技能创建脚手架（生成符合规范的 `SKILL.md` 模板）。

#### [NEW] [skill-hub-diagnostics.ts](file:///d:/github_nishi/ompweb/lib/skill-hub/skill-hub-diagnostics.ts)
- 语法与规范体检：缺少必填 `name`/`description`、描述包含未转义英文冒号、非法字符等；
- 一键自动修复器：原地自动修正 YAML frontmatter。

#### [NEW] [skill-hub-market.ts](file:///d:/github_nishi/ompweb/lib/skill-hub/skill-hub-market.ts)
- 对接 GitHub REST API 递归扫描指定仓库（如 `mattpocock/skills` 等）包含的技能包；
- 提供版本分支/Tag 列表查询、异步技能拉取导入、上游更新对比与增量同步。

#### [NEW] [route.ts](file:///d:/github_nishi/ompweb/app/api/skill-hub/[[...slug]]/route.ts)
- Next.js 通配路由入口，分发处理 `/api/skill-hub/catalog`、`/api/skill-hub/skill`、`/api/skill-hub/toggle`、`/api/skill-hub/create`、`/api/skill-hub/tag`、`/api/skill-hub/market`、`/api/skill-hub/diagnostic/fix` 等请求。

---

### 前端组件与界面呈现层 (`components/skill-hub/`)

#### [NEW] [SkillHubPanel.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/SkillHubPanel.tsx)
- 主面板与子视图路由器：顶部展示技能统计卡片（技能总数、已禁用数、检查更新按钮）；
- 承载【来源 (Sources)】、【场景 (Scenes)】、【市场 (Market)】三大子面板及详情抽屉。

#### [NEW] [SourcesView.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/SourcesView.tsx)
- 技能来源工作台：支持【平铺】与【分组】折叠视图；
- 支持整组三态开关、单技能开关、绿灰状态指示圆点、来源徽章；
- 实时搜索、全部来源下拉过滤、按名称/更新时间多维排序。

#### [NEW] [ScenesView.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/ScenesView.tsx)
- 场景标签管理工作台：创建自定义场景、勾选关联技能、场景一键全部激活/停用。

#### [NEW] [MarketView.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/MarketView.tsx)
- 技能市场工作台：内置精选 GitHub 技能仓库，支持自定义 `owner/repo` 发现、版本选择与一键异步导入安装。

#### [NEW] [SkillDetailView.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/SkillDetailView.tsx)
- 技能详情预览：渲染 Markdown 正文、显示真实物理路径与诊断建议，提供【一键自动修复】按钮。

#### [NEW] [dialogs.tsx](file:///d:/github_nishi/ompweb/components/skill-hub/dialogs.tsx)
- 模态交互弹窗：批量启停冲突提醒、版本切换确认、同步覆盖确认等。

#### [NEW] [skill-hub.css](file:///d:/github_nishi/ompweb/components/skill-hub/skill-hub.css)
- 适配 ompweb 的全局 Design Tokens（`--bg`, `--bg-panel`, `--accent`, `--border`, `--radius-card` 等），确保完美契合深浅色主题。

---

### 设置框架集成 (`components/Settings*.tsx` & `locales/`)

#### [MODIFY] [SettingsTabs.tsx](file:///d:/github_nishi/ompweb/components/SettingsTabs.tsx)
- 将 `skills` 从原有的 `getNormalizedActive` 折叠映射中独立出来；
- 增加顶级菜单项【技能中枢】（Skills Hub），配置专用图标并支持键盘快捷导航。

#### [MODIFY] [SettingsConfig.tsx](file:///d:/github_nishi/ompweb/components/SettingsConfig.tsx)
- 在主设置内容区挂载 `currentTab === "skills"` 面板，渲染 `<SkillHubPanel />`；
- 配置 `.settings-content-scroll` 滚动容器，确保平滑滚动与完整展示。

#### [MODIFY] [zh-CN.json](file:///d:/github_nishi/ompweb/lib/i18n/locales/zh-CN.json)
- 补全技能中枢、来源分组、场景管理、技能市场、一键修复相关的中文字段。

#### [MODIFY] [en.json](file:///d:/github_nishi/ompweb/lib/i18n/locales/en.json) & [ja.json](file:///d:/github_nishi/ompweb/lib/i18n/locales/ja.json)
- 补全英文与日文字典对应翻译。

---

## Verification Plan

### Automated Tests
1. **API 接口单元测试**：
   - 创建 `lib/skill-hub/skill-hub-service.test.mjs` 测试技能扫描、元数据解析、单项及批量启停；
   - 创建 `lib/skill-hub/skill-hub-diagnostics.test.mjs` 测试异常 frontmatter 诊断与自动修复。
   - 运行：`npm test` 确保全部用例通过。
2. **TypeScript 类型校验**：
   - 运行：`npx tsc --noEmit` 确保 0 错误。
3. **代码风格与规范检查**：
   - 运行：`npm run lint` 确保 0 错误、0 警告。

### Manual Verification
1. **界面交互验证**：
   - 打开设置弹窗，点击左侧【技能中枢】导航项；
   - 确认来源视图正确扫描到 `C:\Users\zhang\.agents\skills` 下的所有已安装技能；
   - 切换【平铺】与【分组】视图，测试折叠与单个技能启停、整组批量启停；
   - 测试【场景】功能：创建场景标签、关联技能并测试批量启停；
   - 测试【技能市场】：输入 GitHub 仓库，体验扫描发现与技能导入流程；
   - 测试【正文预览与一键修复】：点击技能查看详情，验证诊断项与一键修复能力。
