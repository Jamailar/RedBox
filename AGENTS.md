# Repository Guidelines

## Project Structure & Module Organization
- `desktop/` is the main Electron + React + TypeScript app. UI lives in `desktop/src/`, while Electron main-process and core services live in `desktop/electron/`.
- `desktop/dist-electron/` contains generated build outputs; do not edit by hand.
- `Plugin/` holds the Chrome extension (manifest v3) for Xiaohongshu content capture and AI rewrite features.
- `Docs/` contains product notes, workflows, and design references.

## Build, Test, and Development Commands
- `npm install` (run inside `desktop/`) installs the desktop app dependencies.
- `npm run dev` (in `desktop/`) starts the Vite dev server for the renderer.
- `npm run build` (in `desktop/`) runs `tsc`, builds the renderer, and packages with `electron-builder`.
- `npm run preview` (in `desktop/`) serves a built renderer for smoke checks.

## Coding Style & Naming Conventions
- TypeScript/TSX uses 4-space indentation, semicolons, and single quotes; follow the surrounding file’s formatting.
- React components live in `desktop/src/pages/` and are `PascalCase` (e.g., `CreativeChat.tsx`).
- IPC channels are string names (e.g., `chatrooms:send`) defined/used in `desktop/electron/` and `desktop/src/`.
- TailwindCSS is used for styling; prefer existing utility patterns over custom CSS.

## Testing Guidelines
- There is no standard test runner configured at the root or in `desktop/` yet.
- If you add tests, document the command and keep test file names explicit (for example, `*.test.ts`) near the code they cover.

## Commit & Pull Request Guidelines
- Commit messages are short and pragmatic, often in Chinese, with occasional `feat:` prefixes. Match this tone.
- PRs should include a clear description, the affected areas (e.g., `desktop/electron/`), and any UI screenshots for renderer changes.

## Security & Configuration Tips
- API keys and model settings are user-configured in the app settings; do not hardcode secrets.
- For new IPC or file system features, validate inputs and keep main-process changes in `desktop/electron/`.

## AI System Design Rule
- This is an AI system. During AI interaction and orchestration flows, avoid hardcoded text/keyword heuristics for user-intent judgment whenever possible.
- Prefer this order of responsibility:
  - skills and system prompts define capability boundaries and decision principles
  - structured metadata / explicit mode flags carry routing intent
  - tool/runtime layers only enforce input validation and safety constraints
- If a behavior must be constrained, prefer structured rules, typed state, and tool contracts over brittle string matching against user messages.
- Hardcoded message-text checks are a last resort only, and any exception should be narrow, explicit, and easy to remove later.

## UX State Rule
- Existing user-visible data must never be replaced by a blocking loading screen just because a refresh starts.
- Default policy is stale-while-revalidate:
  - render cached/existing data immediately
  - refresh in the background
  - show refresh state with local indicators only
- Full-page or full-panel loading is allowed only for true first-load empty states where no usable data exists yet.
- Refresh failures must preserve the last successful data snapshot and surface an inline error instead of clearing the page.
- Login/session/bootstrap flows follow the same rule: use persisted state first, then silently refresh in the background.

## Store Lock Rule
- Global app state locks must stay narrow and memory-only.
- Never hold the global store lock while doing file system I/O, workspace scans, directory creation, hydration, serialization, or other potentially slow work.
- Required pattern is:
  - read the minimal state snapshot under lock
  - release the lock
  - do file/workspace loading outside the lock
  - reacquire the lock only to apply the final in-memory mutation
- Page activation, chat post-response maintenance, workspace bootstrap, and list/load commands must follow this rule by default.
- If cached data can satisfy a page transition, prefer cache-first access and background refresh rather than lock-coupled reloads.
