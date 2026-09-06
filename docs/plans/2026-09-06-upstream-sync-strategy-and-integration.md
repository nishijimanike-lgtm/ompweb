# 上游原生 ompweb 仓库同步策略与变更整合文档

## 概述

本文档记录了本地开发分支（`nishijimanike-lgtm/ompweb`）与上游官方原生仓库（[kahme247/ompweb](https://github.com/kahme247/ompweb)）的长期同步方案架构，以及本次最新上游更新（v0.4.2 之后的 commits: `71cff30`, `5210db1`, `0282fa0`）的整合与冲突解决结果。

---

## 1. 架构与同步工作流规范

### 1.1 Remote 设定
- `origin`: 团队/个人定制版本库（`https://github.com/nishijimanike-lgtm/ompweb.git`）
- `upstream`: 官方原生版本库（`https://github.com/kahme247/ompweb.git`）

### 1.2 日常同步与检查流程
1. **状态检查**：运行 `npm run sync:check`，快速检测上游是否有未合并的提交。
2. **隔离分支合并**：
   ```bash
   git fetch upstream
   git checkout -b sync/upstream-<date>
   git merge upstream/main
   ```
3. **冲突处理原则**：
   - **跨平台与 Windows 适配**（如 `lib/omp/omp-cli.ts`）：保留本地 Windows 批处理/环境支持，清理上游已弃用的废弃代码。
   - **核心 RPC / Agent 状态协议**（如 `lib/rpc-manager.ts`）：采纳上游官方逻辑（如进程隔离、超时重试、状态协商）。
   - **自研扩展模块**（如 `lib/skill-hub/`, `components/FileExplorerContextMenu.tsx`）：保持独立扩展，防止被上游主线意外覆盖。
4. **验证门禁**：
   - `npm run typecheck`
   - `npm test`（确保通过全部单元测试套件）
5. **合入主干**：
   ```bash
   git checkout main
   git merge sync/upstream-<date> --ff-only
   git branch -d sync/upstream-<date>
   ```

---

## 2. 本次同步整合与冲突解决记录

### 2.1 整合的上游提交清单
1. **`71cff30`** (`fix(agent): force fresh session on bare spawn, bound /mcp list ack`):
   - 修复了新会话启动（无 `--resume`）时若工作目录下存在旧会话可能串入历史的问题，在进程启动后强制检查并发送 `new_session`。
   - 将 `/mcp list` 命令应答超时时间绑定到 `PROMPT_ACK_TIMEOUT_MS`，超时自动回收无响应子进程并重置状态，防止 wrapper 陷入永久繁忙（`session_busy`）。
   - 新增针对上述逻辑的 3 个单元测试用例。
2. **`5210db1`** (`refactor: remove dead exports and consolidate duplicated helpers`):
   - 清理多模块未引用的死代码。
   - 复用公用工具：统一引用 `lib/type-guards.ts` 的 `isRecord`、`lib/file-paths.ts` 的 `normalizeFilePathSlashes`、`lib/subagent-types.ts` 的 `asAgentSource`。
3. **`0282fa0`** (`fix: forward ompweb-launchd subcommand from main bin (#52)`):
   - 在 `bin/omp-web.js` 入口处支持转发 `ompweb-launchd` / `launchd` 命令参数并拉起子脚本。

### 2.2 冲突解决细节
- **冲突文件**: `lib/omp/omp-cli.ts`
- **产生原因**:
  - 上游移除了无引用的 `invalidateOmpCliCache()`。
  - 本地添加了 Windows 下 `omp.cmd`/`omp.bat` 的识别与参数处理函数 `isWindowsBatch()` 和 `formatWindowsBatchArgs()`。
- **解决方式**:
  - 保留 Windows 增强实现（`isWindowsBatch`, `formatWindowsBatchArgs`, `BIN_NAMES`, 批处理安全传参与 `execFile` 配置）。
  - 顺应上游重构，移除未被任何模块调用的 `invalidateOmpCliCache()`。
- **验证结果**:
  - TypeScript 类型检查：0 错误。
  - 全量单元测试：543 passed（新增 3 项 RPC 测试全部通过），0 failed。
