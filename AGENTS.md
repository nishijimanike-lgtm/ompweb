# Repository Guidelines

## Project Overview

`ompweb` (`@kahme247/ompweb`) is a local, browser-based desktop workspace for the [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) coding agent. It enables browsing existing terminal sessions, continuing active conversations, configuring models and settings, managing skills/plugins/MCP servers, and inspecting workspace files without creating a duplicate agent runtime or secondary credential store.

### Core Principles
- **OMP is authoritative**: Session `.jsonl` files, credentials (`agent.db`), provider configs, and tool execution remain owned by the local `omp` CLI.
- **Node-first runtime**: Runs on standard Node.js (22.19+) and Next.js (App Router). Never imports Bun-only `@oh-my-pi/*` or `@earendil-works/*` packages inside the server.
- **Local-first security**: Binds `127.0.0.1` by default; file system browsing is restricted to allowed workspace roots and sessions.

---

## Architecture & Data Flow

```
Browser (React 19 / Next.js Client)
  │
  ├─ GET  /api/sessions ────────────▶ Pure Node read of ~/.omp/agent/sessions/
  ├─ GET  /api/sessions/[id] ───────▶ Pure Node .jsonl parse (lib/session-reader.ts)
  ├─ GET  /api/agent/running/events ─▶ SSE stream of active session IDs
  │
  ├─ POST /api/agent/[id] ──────────▶ startRpcSession() in lib/rpc-manager.ts
  │                                     │ spawns child process
  │                                     ▼
  │                                   omp --mode rpc-ui (NDJSON stdio)
  │
  └─ GET  /api/agent/[id]/events ───▶ Server-Sent Events (stream frames to client)
```

### 1. Read-Only Browsing vs. Active Execution
- **Session Browsing**: Handled purely in Node via `lib/session-reader.ts`. Reads OMP v3 `.jsonl` session files, resolves external blob references (`~/.omp/agent/blobs`), builds tree context from `(id, parentId)` pairs, and extracts compaction summaries. No child process is spawned.
- **Active Chat / Tool Execution**: Handled via `startRpcSession()` in `lib/rpc-manager.ts`. Spawns `omp --mode rpc-ui` (one child per active session), communicates via NDJSON over stdio (`lib/omp/rpc-process.ts`), and streams events to the browser over SSE (`/api/agent/[id]/events`).

### 2. Event Protocol & Reconciliation
- OMP events differ from legacy Pi: OMP emits no `prompt_done` or `compaction_start/end`. Terminal completion is signaled by `agent_end` (`isTerminal !== false`).
- `useAgentSession.ts` assigns a monotonic `promptRunId` to each prompt turn. Late SSE frames or slow reconciliation responses from past runs are dropped to prevent resurrecting stale streaming bubbles.
- Periodic polling (`GET /api/agent/[id]`) and `visibilitychange`/`online` event listeners reconcile state after network or background tab interruptions.

### 3. Subagent Integration & History
- **Live State**: `subagent_progress` SSE frames update `SubagentInfo.progress` (tool activity, tokens, cost, context gauge, retries).
- **On-Disk Transcripts**: Subagents persist to sibling directories (`<session-dir>/<subagent-id>.jsonl` and `<subagent-id>.md`). `lib/subagent-history.ts` reconstructs subagent rosters on reload even after terminal subagents vanish from the live RPC registry.

### 4. Skill Hub & Multi-Root Discovery
- Pure-Node multi-root skill scanner (`lib/skills-service.ts` & `lib/skill-hub/skill-hub-service.ts`) mirrors OMP discovery order:
  1. Project `.omp/skills` (walk-up) & user `~/.omp/agent/skills`
  2. Claude compat (`~/.claude/skills` & project `.claude/skills`)
  3. Agent compat (`~/.agents/skills`, `~/.agent/skills`, project `.agents/skills`, `.agent/skills`)
  4. DSH compat (`~/.dsh/skills` & project `.dsh/skills`)
  5. Codex compat (`~/.codex/skills` & project `.codex/skills`)
  6. GitHub compat (`<repoRoot>/.github/skills`)
  7. Managed auto-learned skills (`~/.omp/agent/managed-skills`)

---

## Key Directories

```
app/
  api/                    # Next.js App Router API route handlers
    agent/                # RPC command dispatch, new session spawn, running SSE
    sessions/             # Session list, jsonl retrieval, context, export, subagents
    skill-hub/            # Unified Skill Hub (catalog, toggle, tags, market, sync)
    skills/               # Skills discovery, installation, and search
    mcp/                  # Project MCP configuration endpoints
    plugins/              # OMP CLI plugin manager bridge
    projects/             # Managed project registry endpoints
    worktrees/            # Git worktree discovery, branch creation, pruning
components/
  AppShell.tsx            # Main shell, layout, tab management, sidebar state
  ChatWindow.tsx          # Chat viewport, message grouping, audio completions
  ChatInput.tsx           # Prompt composer, slash commands, @-mention file autocomplete
  ComposerPanels.tsx      # Pinned collapsible Todo plan and Subagent roster
  MessageView.tsx         # Message renderer (user, assistant, toolCall, toolResult)
  SessionSidebar.tsx      # Project/session tree, worktree switcher, file explorer
  skill-hub/              # Skill Hub panels (SourcesView, ScenesView, MarketView, Detail)
  ui/                     # Base UI primitives (primitives.tsx, field.tsx, toast.tsx)
hooks/
  useAgentSession.ts      # Core chat state machine, SSE streaming, RPC commands
  useAudio.ts             # Audio completion chime with browser unlock policy
  useTheme.ts             # Theme state (warm-paper light / warm-ember dark)
lib/
  omp/                    # Low-level OMP foundations (paths.ts, omp-cli.ts, rpc-process.ts)
  skill-hub/              # Skill Hub service, store, market downloader, diagnostics
  rpc-manager.ts          # Global session wrapper registry & process supervisor
  session-reader.ts       # Pure-Node JSONL parser, context builder, list cache
  skills-service.ts       # Multi-root skill scanner and frontmatter updater
  project-registry.ts     # Managed projects persistence (~/.omp/agent/projects.json)
  worktree.ts             # Git worktree resolution and lifecycle helpers
bin/
  omp-web.js              # Standalone CLI entrypoint (`ompweb`)
  omp-web-tray.js         # System tray daemon (Windows / macOS / Linux)
```

---

## Development Commands

```bash
# Development server (port 30178, binds 127.0.0.1)
npm run dev

# Development server accessible over LAN (binds 0.0.0.0)
npm run dev:lan

# Typecheck TypeScript (zero emit)
npm run typecheck
# or directly:
node node_modules/typescript/bin/tsc --noEmit

# Lint codebase (ESLint 9)
npm run lint

# Run all unit test suites
npm test

# Run a specific test file with Node's native test runner
node --test lib/skill-hub-service.test.mjs
node --test components/ChatInput.test.mjs

# Production build & start (port 30177)
npm run build
npm start
```

> **CRITICAL RULE**: **Never run `next build` during dev**. It pollutes `.next/` with production manifests and breaks `npm run dev` chunk resolution.

---

## Code Conventions & Common Patterns

### 1. Bun vs. Node Boundary
- Never import `@oh-my-pi/*` or `@earendil-works/*` packages in server code.
- OMP execution is isolated to child processes running `omp --mode rpc-ui`.

### 2. State & RPC Process Lifecycle (`lib/rpc-manager.ts`)
- Active sessions are stored in `globalThis.__ompWebRpcSessions` to survive Next.js fast-refresh during development.
- Concurrent calls to `startRpcSession(sessionId)` share a single pending startup promise to avoid duplicate process spawning.

### 3. Two Forms of Branching
- **Fork** (Fork button on message): Creates a new independent `.jsonl` file with `parentSession: "/path/to/parent.jsonl"`. Displayed as a tree child in the sidebar.
- **In-Session Branch** (Continue / BranchNavigator): Navigates alternative turns within the same `.jsonl` file using `(id, parentId)` trees via `/api/sessions/[id]/context?leafId=`.

### 4. ToolCall Field Normalization
- On-disk session `.jsonl` entries use `{ type: "toolCall", id, name, arguments }`.
- Client and UI components use `{ toolCallId, toolName, input }`.
- `normalizeToolCalls()` in `lib/normalize.ts` must be called on both disk loads and live SSE frames.

### 5. Session List Cache Invalidation
- `listAllSessions()` caches results with a 30s TTL in `lib/session-reader.ts` and a directory walk cache in `lib/omp/session-files.ts`.
- On Windows/NTFS, adding a `.jsonl` inside a subfolder does not update the parent directory mtime.
- Any session mutation (save, delete, rename, compaction, `agent_end`) MUST call `invalidateSessionListCache()`, which also clears `invalidateSessionFileListCache()`.

### 6. Atomic File Operations & Safe Scopes
- Configuration updates (`skill-hub.json`, `projects.json`, MCP configs) write to temporary files first (`.tmp`) and atomically rename them.
- File browsing (`/api/files`) is strictly allow-listed via `isExistingFilePathAllowed()` against known session directories, worktree roots, and explicit roots from `allowFileRoot()`.

### 7. UI Design Tokens & Styling
- Colors use CSS variables defined in `app/globals.css` (e.g., `--bg`, `--bg-panel`, `--border`, `--text`, `--text-muted`, `--accent`). Do not hardcode hex/RGB values.
- UI primitives are built on `@base-ui/react` (`components/ui/primitives.tsx`).
- Icons MUST come from `lucide-react`. Do not introduce raw SVG icons.

---

## Important Files

| File | Purpose |
|---|---|
| `hooks/useAgentSession.ts` | Main client session controller: prompt submission, SSE stream reduction, optimistic messages, reconciliation |
| `lib/rpc-manager.ts` | Session supervisor: process spawning, NDJSON command dispatch, running session subscriptions |
| `lib/omp/rpc-process.ts` | Process wrapper: protocol negotiation (v1/v2), chunked frame reassembly, stdio management |
| `lib/session-reader.ts` | High-performance JSONL parser, title reader, active branch builder, session path cache |
| `lib/skills-service.ts` | Pure-Node multi-root skill discovery and frontmatter mutation |
| `lib/skill-hub/skill-hub-service.ts` | Skill Hub service: disk scans, `.disabled` toggling, diagnostics, tag and origin management |
| `components/AppShell.tsx` | Top-level layout, session tabs, sidebar state, keyboard shortcut routing |
| `components/ChatInput.tsx` | Composer input, slash command palette, file `@`-autocomplete, model and thinking selectors |
| `components/ComposerPanels.tsx` | Fixed status panels above input: live todo list and active subagent telemetry chips |
| `lib/worktree.ts` | Git worktree discovery, linked worktree resolution back to main project root |

---

## Runtime & Tooling Preferences

- **Node.js**: `v22.19.0+` required.
- **Package Manager**: `npm` (project uses `package-lock.json`).
- **TypeScript**: Strict mode enabled, `ES2017` target, `bundler` module resolution, paths alias `@/*` -> `./*`.
- **Styling**: Tailwind CSS v4 + PostCSS with CSS Modules (`*.module.css`) and design tokens in `app/globals.css`.
- **Environment Variables**:
  - `OMP_WEB_OMP_BIN`: Path to `omp` binary (defaults to searching `PATH`).
  - `OMP_WEB_PASSWORD`: Optional password protection for server endpoints.
  - `OMP_WEB_HOSTNAME`: Server bind address (default `127.0.0.1`).
  - `AGENTS_HOME` / `CLAUDE_CONFIG_DIR` / `PI_CODING_AGENT_DIR`: Custom directories for skills and agent state.

---

## Testing & QA

### Framework
- Uses Node.js native test runner (`node --test`).
- Uses `jiti` to import TypeScript modules dynamically within ESM test files (`*.test.mjs`).

### Conventions
- Test files use the `.test.mjs` extension and reside alongside their implementation modules (`lib/*.test.mjs`, `components/*.test.mjs`, `hooks/*.test.mjs`).
- Filesystem tests use temporary directories (`mkdtempSync(join(tmpdir(), "..."))`) and clean up in `finally` blocks.
- Tests avoid spawning external network requests or live child processes; mocked fixtures and JSONL files are preferred.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
