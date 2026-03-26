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
