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

### RPC session lifecycle (`lib/rpc-manager.ts`)
- One wrapper per session id, keyed in a `globalThis` registry.
- `globalThis` survives Next.js hot-reload; plain module-level Map does not.
- Idle sessions are disposed after a timeout; concurrent `startRpcSession()`
  calls must share a single start promise.

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in the sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): navigates the entry tree within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### ToolCall field normalization
Sessions store toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and streaming event handling.

### Live tool execution (`tool_execution_start/update/end`)
omp announces a tool the moment it starts, streams the tool's output while it
runs, and only commits the `toolResult` message at the end. The UI must not
wait for that commit:
- `useAgentSession` keeps a `liveToolResults` map keyed by `toolCallId`
  (seeded on `tool_execution_start` with `partial: true`, refreshed on
  `tool_execution_update` — omp sends the FULL accumulated partial result per
  chunk, latest wins — and released on `_end`/the committed toolResult).
  Committed results always win over live entries (`ChatWindow` merges them), so
  a reload never shows a stale snapshot.
- `ToolCallBlock` renders a `partial` result as **running** (spinner, and
  "Running tool…" instead of the "(no output)" marker when nothing has been
  printed yet), and opens the row while it runs when the "Keep tool calls
  collapsed" setting is off — that is what that setting means. `AppShell` must
  pass `toolCallsDefaultCollapsed` into `ChatWindow`; without it the setting is
  inert (the chat then always collapses).
- `tool_execution_update` is coalesced per tool call at display rate in
  `lib/message-update-coalescer.ts` (chatty commands emit ~10-100+ frames/s).
  `message_end` drops the pending `message_update` (the committed message
  supersedes it) but must NOT drop buffered tool updates.
- Live entries are cleared on `agent_start`, terminal `agent_end`, prompt
  send/settlement failure — a tool must never leak into the next run.

### Event protocol differences vs pi
omp emits no `prompt_done` / `prompt_error` / `queue_update` /
`compaction_start` / `compaction_end` events. Completion is `agent_end`
(`isTerminal !== false`), errors surface as failed RPC responses plus `notice`
events, and the queue length comes from `get_state.queuedMessageCount`.
New frame types (`turn_start/end`, `notice`, `todo_reminder`, ...) must be
handled or safely ignored.

### Running state SSE + reconciliation
- The sidebar listens to `/api/agent/running/events`, backed by `subscribeRunningSessions()` in `lib/rpc-manager.ts`, so running badges update without polling.
- `useAgentSession` still treats per-session SSE as primary for chat events, but while a run is active it periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed `agent_end` events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.

### Composer-attached panels (`components/ComposerPanels.tsx`)
- The live todo plan (`TodoList`) and the subagent roster live **pinned above
  the chat input**, not inside the scrollable message list. `ComposerPanels`
  renders both, each independently collapsible via its header row (`chevron`);
  panels start collapsed (headers always show live progress / running-summary).
  Subagent chips carry live state (pulsing dot while `started`, check/alert/ban
  for terminal states) fed by the same `subagent_lifecycle`/`subagent_progress`
  SSE frames; clicking a chip opens the transcript dialog. `TodoList` keeps a
  non-collapsible default (`collapsible` prop) for SSR tests.

### Subagent integration (`lib/subagent-types.ts`, `lib/subagent-history.ts`)
- **Live detail**: `subagent_progress` frames carry the full `AgentProgress`
  object — `lib/subagent-types.ts` parses it defensively into
  `SubagentInfo.progress` (current tool/intent, tokens, cost, context
  gauge, resolved model, retry state, detached flag, agentSource). The
  composer chips surface the current activity + telemetry line; retry
  (`⟳ retrying N/M`) takes precedence over the tool line. `subagent_event`
  frames also feed a bounded per-subagent activity buffer shown in the
  transcript dialog.
- **Roster hydration**: `get_subagents` snapshots (which carry progress)
  rehydrate the roster after SSE reconnect (`refreshSubagentRoster`, wired
  into mount, send, and the reconcile poll). Terminal subagents vanish from
  the RPC registry — history fills that gap.
- **On-disk history** (`lib/subagent-history.ts`, `/api/sessions/[id]/subagents*`):
  omp persists each subagent's transcript to the parent session's sibling
  artifacts dir (`<session-dir>/<subagent-id>.jsonl`) and the parent file's
  task toolResults keep `progress[]`/`results[]` snapshots. omp-web recovers
  the roster from disk (`extractSubagentHistory`, result fields win over the
  mid-run snapshot), so past/finished runs show in the composer panel after a
  reload. The transcript route pages the sibling file byte-wise (mirroring
  `get_subagent_messages`, which is RPC-registry-gated and refuses files it
  doesn't know). The dialog reads only the final output — `<id>.md` via
  `?mode=completion` (bounded tail read that also works for transcripts
  beyond the 16MB paging cap) with a live `get_subagents` snapshot fallback
  for header enrichment; it never pages the raw transcript. Subagent ids are
  `[A-Za-z0-9_-]{1,80}` — the route validates before joining to confine reads
  to the sibling dir.
- **In-message task summary** (`components/MessageView.tsx` TaskResultPanel):
  the session reader allowlists a SIZE-BOUNDED subset of `task` toolResult
  details (telemetry only — no `output`/`stderr`, long text truncated to
  240 chars, `lib/session-reader.ts` `keepTaskToolResultDetails`), and
  expanded `task` tool calls render a per-subagent summary (status, agent,
  task, tokens/cost/duration/model, async marker) above the raw result text.
- **Chip extras**: agent-source labels (`user`/`project`), nested-subagent
  count (`inflightTaskDetails`/`extractedToolData.task` progress), and the
  `⤴` async marker (live `detached` flag or history `details.async`
  presence). Shared formatters live in `lib/subagent-format.ts`.

### Worktrees and project grouping
- `lib/worktree.ts` resolves linked worktree top-levels back to the main repo `projectRoot`; `listAllSessions()` attaches that to each `SessionInfo` so all worktrees for one repo are grouped together in the sidebar.
- Worktree operations are served by `/api/worktrees` and guarded by the same allowed-root rules as `/api/files`.
- New worktrees are created under `<repoRoot>-worktrees/<sanitized-branch>`. Existing branches are reused; otherwise `git worktree add -b` creates the branch.
- Removing a dirty worktree returns `409` with `{ dirty: true }` so the UI can ask before retrying with `force`.
- Sessions whose cwd points at a removed worktree are inferred back into the main project instead of becoming a phantom project row.

### Managed projects sidebar (`lib/project-registry.ts`, `/api/projects`)
- The sidebar lists **managed projects**: explicitly added directories (registered in
  `~/.omp/agent/projects.json`, written atomically as temp-file + rename) plus
  session-discovered ones — hidden entries excluded. Removing a project only
  marks it hidden (reversible via re-adding); hidden entries suppress session
  re-discovery.
- Registry paths are canonical `projectRoot`s: `POST` resolves worktrees to
  their main repo via `resolveProject`, and `resolveProject` returns the
  symlink-free on-disk form for plain directories so registered and
  session-discovered paths compare equal on Windows casing.
- `GET /api/projects` re-authorizes registered roots with `allowFileRoot()` —
  the in-memory browse allowlist does not survive restarts, and empty managed
  projects derive no root from sessions.
- The client sorts the merged list by most-recently-added (registration
  order), then by path for session-discovered projects
  (`lib/project-ordering.ts`); the order deliberately does NOT depend on
  session activity, so project rows never jump around while sessions refresh.
  Expanded project paths live
  in `localStorage` (`omp-web:expanded-projects`), defaulting to only the
  active/restored project expanded, and stale keys are pruned against the
  current project list (only after the first project fetch — an empty
  still-loading list must never wipe storage).
- Each project's session tree is capped at 5 roots with a show-more toggle;
  project rows are cards matching the session items' height/margins/accent
  treatment, and the active project's worktree selector renders directly
  below its row.

### File access allow-list
- `/api/files` is intentionally not a general filesystem browser. Allowed roots come from session cwds, their resolved project roots, `~/omp-cwd-*`, and roots explicitly added with `allowFileRoot()`.
- `/api/cwd/validate`, `/api/default-cwd`, and `/api/worktrees` call `allowFileRoot()` when they make a new location browsable.

### Session list caching — new sessions must appear immediately
- `listAllSessions()` (sidebar, command palette) is cached twice: a 30s TTL
  list cache in `lib/session-reader.ts` plus an mtime-keyed directory walk in
  `lib/omp/session-files.ts` (`listSessionFiles`).
- The walk cache keys on the **sessions root** mtime. On Windows/NTFS a new
  `.jsonl` inside an existing project subdirectory does NOT bump the root
  mtime, so the walk stays stale indefinitely.
- `invalidateSessionListCache()` (fired on `agent_end`, `session_info_update`,
  compaction, renames) must therefore ALSO clear the walk cache via
  `invalidateSessionFileListCache()` — never add a session-mutation path that
  forgets this. Regression test: `session-reader.test.mjs`.

### Chat scroll-follow
- `useAgentSession` follows the conversation: the effect depends on both
  `messages` (boundaries) and `streamState` (every token batch) and throttles
  to one `requestAnimationFrame` while a run is active (`followScrollFrameRef`).
- A manual scroll-up sets `completionScrollAllowedRef = false` and disables
  following until the next prompt; `scrollUserMsgToTop` handles the
  pending-scroll after sending.
- Programmatic smooth scrolling must respect `prefers-reduced-motion`
  (`usePrefersReducedMotion` in `hooks/usePrefersReducedMotion.ts` — also the
  only way to stop SVG SMIL animations, which CSS cannot).

### MCP configuration (`lib/omp/mcp-config.ts`, `/api/mcp`, `components/McpConfig.tsx`)
- Project MCP config resolution order: `.omp/mcp.json`, `.omp/.mcp.json`,
  `mcp.json`, `.mcp.json` at the git top level (falls back to cwd for
  non-git dirs). Server definitions support `stdio`, `http`, and `sse`;
  exactly one of `command`/`url` is required and validated before any write.
- Writes are atomic (temp file + rename), preserve unrelated top-level keys
  (`disabledServers`, `$schema`, ...), and support rename via `previousName`.
- The MCP settings live in their own Settings tab (`SettingsTabs` id `"mcp"`,
  workspace-gated). Server list rows show a config-derived status dot
  (valid+enabled / disabled / invalid) — no live-connectivity probe exists in
  the RPC protocol, so failures surface as toasts (`toast.error`) from the
  editor actions, not inline text.
- The endpoint is guarded by the same allowed-root rules as `/api/files`.

### Plugins and skills
- `/api/plugins` shells out to the user's `omp plugin` CLI (`list/install/uninstall/enable/disable/upgrade`, `--json` where available) — never the Bun-only SDK.
- `/api/skills` uses `lib/skills-service.ts`, a pure-Node scanner mirroring omp's discovery order: project `.omp/skills` (walk-up), `~/.omp/agent/skills`, then the `.claude` / `.agent(s)` / `.codex` / `.github` compat dirs and managed skills.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent universal`, which installs into the ecosystem-standard `.agents/skills` dirs omp reads; project installs run with the selected cwd.

### Update notifications (`/api/omp-update`, `/api/app-update`)
- Automatic in-app self-updating has been removed in favor of explicit user notifications and manual terminal commands.
- `GET /api/app-update` queries the npm registry for `@kahme247/ompweb` updates, detects the install manager (`bun` vs `npm` via `detectInstallMethod`), and returns `updateAvailable` plus the exact terminal command (e.g. `npm install -g @kahme247/ompweb` or `bun add -g @kahme247/ompweb`).
- `POST /api/omp-update` (`action: "check"`) runs `omp update --check` and returns `updateAvailable` plus `updateCommand: "omp update"`.
- `POST /api/omp-update` (`action: "restart"`) restarts active OMP sessions after a manual CLI update.
- Notifications in `AppShell` and settings cards in `SettingsConfig` present the update notification alongside copyable terminal update commands.

### Auth and model config
- Auth flows go through RPC commands (`get_login_providers`, `login`) against the omp child process; credentials live in omp's `agent.db` (SQLite) which omp-web never touches directly.
- The Models panel reads and writes `models.yml` in the omp agent directory (`~/.omp/agent/models.yml`, `.yaml` fallback).
- API-key status endpoints must never return the raw key.

### Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` and reuses one `AudioContext`.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

## omp Session File Format (v3)

Location: `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"title","v":1,"title":"...","source":"...","updatedAt":"...","pad":"   ..."}   ← fixed 256-byte slot
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"...","modelId":"...","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
```

- Line 1 is a fixed-width 256-byte padded title slot, rewritable in place.
  Old pi files may lack it — the `{"type":"session"}` header is then line 1.
- Entries form a tree via `(id, parentId)`. Additional entry types
  (`title_change`, `session_init`, `mode_change`, `ttsr_injection`, ...) must
  be tolerated by readers.
- Large payloads (images) are externalized to the content-addressed blob store
  at `~/.omp/agent/blobs` and referenced from entries.

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and navigate_tree calls.
>>>>>>> upstream/main

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
