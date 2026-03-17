# RedClaw vs OpenClaw Gap Analysis

Date: 2026-03-16  
Scope: turn RedConvert/RedClaw into a Xiaohongshu-creation version of OpenClaw.

## What OpenClaw’s agent runtime does well (code-level observations)

From `openclaw/openclaw` `src/agents/*`, the production-grade capabilities are centered on:

1. Robust run loop and stream handling
- Dedicated embedded runner + subscribe pipeline.
- Handles duplicate/later provider chunks, block streaming, directive parsing, usage accounting.

2. Context management and compaction
- Adaptive token estimation + chunked summarization + retry/fallback paths.
- Context-window discovery and model-specific limits.

3. Transcript/tool integrity
- Repair tool-call/tool-result pairing.
- Cap oversized tool results and sanitize untrusted details before persistence.

4. Tool governance
- Tool policy pipeline by provider/model/session/channel/identity.
- Loop detection (repeat/poll/ping-pong/global breaker).

5. Memory + skills as first-class runtime objects
- Memory search strategy/config and citations mode.
- Skills loading/install/sync with explicit prompt gating.

## Current RedClaw baseline (this repo)

Already in place:
- Pi-agent-core based chat runtime.
- Single-session RedClaw context + auto-compact.
- Skills panel + ClawHub market install path.
- File-based long-term memory injection + `save_memory`.

Main gaps to make “Xiaohongshu OpenClaw” actually成立:

1. Productized workflow modules (goal -> copy -> image -> publish -> review).
2. Artifact persistence model for each creation project (not just chat text).
3. Post-publish retrospective data loop.
4. Stronger tool/runtime guardrails (loop detection, tool-output caps, transcript repair analogs).
5. Future: provider/model-specific execution policy and richer observability.

## Modules started in this change

Implemented in this batch:

1. RedClaw project module (file-based)
- Create/list/load project metadata under `<workspace>/redclaw/projects/*`.

2. RedClaw artifact modules
- Copy pack persistence (`copy-pack.md/.json`).
- Image prompt pack persistence (`image-pack.md/.json`).
- Retrospective persistence (`retrospective.md/.json`) with derived rates.

3. Agent tool modules
- `redclaw_create_project`
- `redclaw_save_copy_pack`
- `redclaw_save_image_pack`
- `redclaw_save_retrospective`
- `redclaw_list_projects`

4. RedClaw prompt workflow wiring
- RedClaw mode now instructs mandatory tool-backed flow.
- Injects recent project context into system prompt for continuity.

5. RedClaw UI module entry points
- RedClaw chat shortcuts switched to project/copy/image/review workflow.
- Skills drawer adds a “项目” tab to view recent projects.

## Next priority modules (recommended)

1. Image generation execution module
- From “prompt pack” to optional real image generation and file write-back.

2. Publish telemetry ingest module
- Structured input/import for Xiaohongshu metrics to reduce manual retrospective entry.

3. Runtime guardrail module
- Add tool-loop breaker + oversized tool-output truncation + transcript pairing checks.

4. Planning/execution state machine
- Explicit per-project phase transitions, status badges, and resumable checkpoints.
