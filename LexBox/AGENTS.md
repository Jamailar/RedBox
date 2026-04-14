# Repository Guidelines

## Project Structure And Ownership

- `src/` is the React renderer. App bootstrap lives in `src/main.tsx`, top-level view switching lives in `src/App.tsx`, and product surfaces live in `src/pages/`.
- `src/bridge/ipcRenderer.ts` is the compatibility bridge exposed as `window.ipcRenderer`. Renderer code should route host access through this bridge instead of calling Tauri APIs ad hoc from pages.
- `src/runtime/` contains runtime event consumption and session-facing frontend helpers. Use it when wiring streaming/runtime UI behavior.
- `src/components/` contains reusable renderer UI. Keep page-specific orchestration in `src/pages/` unless the pattern is already shared.
- `src/features/` holds larger vertical features such as official publishing and video editor flows.
- `src-tauri/src/main.rs` is the Tauri host entry and still carries important routing/state glue. Treat it as host composition code, not a dumping ground for new business logic.
- `src-tauri/src/commands/` is the main host command surface, organized by domain (`chat`, `runtime`, `manuscripts`, `library`, `redclaw`, `subjects`, `spaces`, etc.).
- `src-tauri/src/events/` owns event emission and compatibility event mapping. New runtime-style events should start here.
- `src-tauri/src/persistence/` and `src-tauri/src/workspace_loaders.rs` own local state persistence and workspace hydration. Do not duplicate scanning/hydration logic in commands or renderer code.
- `src-tauri/src/scheduler/` owns schedule calculation and derived task timing state, not model execution itself.
- `skills/`, `builtin-skills/`, and `prompts/` contain agent-facing assets. Preserve naming and file formats because runtime code expects them.
- `docs/` stores migration notes, architecture references, and IPC inventory. Update these when a structural change would otherwise become tribal knowledge.

## Architecture Map

- Renderer flow: `src/main.tsx` -> `src/App.tsx` -> `src/pages/*` / `src/components/*`.
- Host call path: renderer code -> `window.ipcRenderer` bridge -> Tauri `ipc_invoke` / `ipc_send` -> host routing in `src-tauri/src/main.rs` and `src-tauri/src/commands/*`.
- Event path: host code emits through `src-tauri/src/events/` -> renderer subscribes through `window.ipcRenderer.on(...)` or runtime stream helpers.
- Persistence path: command/runtime code reads minimal in-memory state, performs file/workspace I/O in persistence/loaders, then applies final in-memory mutation.
- Runtime/AI work should be traced across page -> bridge -> commands -> runtime/persistence. Avoid fixing only one layer when the behavior crosses boundaries.

## Build, Run, And Verification

- `pnpm install` installs the renderer and Tauri workspace dependencies.
- `pnpm build` runs the TypeScript renderer build.
- `pnpm tauri:dev` starts the Tauri desktop app in development.
- `pnpm tauri:build` builds the desktop bundle.
- `pnpm ipc:inventory` regenerates the IPC inventory documentation when channel coverage changes.
- `cd src-tauri && cargo fmt --check && cargo check` is the baseline Rust verification when host code changes.
- There is no standard automated frontend test runner configured yet. If you add tests, place them near the code they cover and document how to run them.

## Coding And Change Rules

- Preserve the local style of the file you touch. This repo mixes older and newer code; do not restyle unrelated sections.
- Prefer existing `window.ipcRenderer` helpers over direct `invoke()`/`listen()` usage in page code. If a new host channel is needed, add or extend the bridge instead of scattering raw channel strings.
- Keep channel and event naming aligned with existing domain groupings such as `chat:*`, `runtime:*`, `manuscripts:*`, `knowledge:*`, and `redclaw:*`.
- New compatibility events should be emitted from `src-tauri/src/events/`, not handcrafted in random command handlers.
- Keep renderer pages responsive by preserving existing data during refresh. Use stale-while-revalidate behavior by default.
- For routine UI actions, prefer existing icon-first affordances and avoid helper text unless the action is ambiguous or risky.
- Do not hardcode secrets, model keys, endpoints, or machine-specific paths.

## AI System Design Rules

- This is an AI product. Avoid hardcoded message-text or keyword heuristics for user-intent routing whenever possible.
- Prefer this order of responsibility:
  - skills and prompts define capability boundaries
  - structured metadata, typed payloads, or explicit mode flags carry routing intent
  - runtime/tool layers enforce validation and safety
- If a constraint is necessary, prefer typed state, explicit contracts, and narrow validation over brittle string matching on user messages.

## State, Loading, And Lock Rules

- Existing visible data must not be replaced by a blocking loading screen just because a refresh starts.
- Default to stale-while-revalidate:
  - render cached or already-loaded data immediately
  - refresh in the background
  - show local refresh indicators only
- Refresh failures must keep the last successful snapshot visible and report an inline error instead of clearing the UI.
- Global store locks must stay narrow and memory-only.
- Never hold a global store lock while doing file I/O, workspace scans, directory creation, hydration, serialization, or other slow work.
- Required pattern:
  - read the minimum state snapshot under lock
  - release the lock
  - perform file/workspace work outside the lock
  - reacquire only to apply the final in-memory mutation
- Commands, page activation flows, chat post-response maintenance, and workspace bootstrap should follow this pattern by default.

## Common Change Playbooks

### Add Or Change A Host Capability

- Start from the consuming renderer page or component in `src/pages/` or `src/components/`.
- Add or extend the `window.ipcRenderer` helper in `src/bridge/ipcRenderer.ts`.
- Implement or route the host behavior in `src-tauri/src/commands/` or the relevant helper/runtime module.
- If the capability affects persistence or workspace files, move file access into `src-tauri/src/persistence/` or `src-tauri/src/workspace_loaders.rs` instead of embedding it in command code.
- If the change introduces events, emit them through `src-tauri/src/events/`.

### Add Or Change A Runtime/Streaming Flow

- Check the renderer consumer in `src/pages/Chat.tsx`, `src/pages/RedClaw.tsx`, `src/runtime/runtimeEventStream.ts`, or related runtime UI first.
- Prefer unified `runtime:event` transport for new event categories.
- Keep legacy `chat:*` or `creative-chat:*` compatibility only when an existing page still depends on it.
- Do not replace structured runtime state with message-text parsing.

### Add Or Change Workspace Data

- Keep workspace scanning and hydration in host persistence/loaders code.
- Do not scan directories directly from React pages.
- Preserve currently visible data while background refresh runs.
- If the feature touches spaces, manuscripts, media, archives, knowledge, or subjects, verify both the active space behavior and persisted reload behavior.

### Add Or Change Navigation Or A Page

- Wire the page in `src/App.tsx` and keep the current lazy-loading/view-switching pattern.
- Reuse `Layout` navigation patterns instead of creating a second navigation system.
- When a page has background refresh, preserve the last successful state during transitions and retries.

## Known Pitfalls

- Do not rely on old `desktop/` or Electron assumptions. This workspace runs through Tauri v2 + Rust host boundaries.
- Do not bypass `src/bridge/ipcRenderer.ts` from renderer code unless you are editing the bridge/bootstrap layer itself.
- Do not implement workspace/file hydration in command handlers or React hooks when persistence/loaders already own that concern.
- Do not clear visible page data on routine refresh failures.
- Do not hold store locks across disk or workspace operations.
- Do not introduce user-intent routing based on ad hoc string matching when structured flags or metadata can carry intent.
- Do not add broad refactors to `src-tauri/src/main.rs` unless they directly support the task; prefer moving new logic into domain modules.

## Documentation Expectations

- When you add or significantly change IPC surfaces, update `docs/ipc-inventory.md` or rerun `pnpm ipc:inventory` if that document is expected to stay current.
- When you split or move major Rust modules, update the nearby `README.md` or `*.README.md` files in `src-tauri/src/`.
- When a new architectural rule is learned from a bug, add it here as a narrow, explicit rule or pitfall instead of leaving it implicit.
