# Runtime Capability Guardrails

Phase 3 upgrades the unified tool runtime from simple `tool pack + allowedTools` filtering to a full capability policy layer.

## What exists now

- Every interactive tool call resolves a `CapabilitySet` before execution.
- `CapabilitySet` merges:
  - `runtimeMode` default pack
  - session metadata such as `allowedTools`
  - active skill overlays
  - entry kind derived from session/runtime context
- High-risk tools and actions now carry approval levels:
  - `none`
  - `light`
  - `explicit`
  - `always_hold`

## Entry kinds

- `interactive`: normal user-facing chat/editor/redclaw turn
- `background_task`: scheduler or automation runtime
- `subagent`: child runtime spawned from orchestration
- `diagnostics`: developer diagnostics runtime

## Guard behavior

All unified tools now go through `tools::guards::preflight_tool_call(...)`.

Guard checks include:

- tool is present in the resolved `CapabilitySet.allowedTools`
- path-like arguments stay relative to `currentSpaceRoot`
- profile doc writes only run in `redclaw` or `diagnostics`
- MCP server calls must target a known enabled server
- MCP actions are filtered by `CapabilitySet.mcpScope`
- automated entries (`background_task`, `subagent`) are blocked when approval reaches `explicit` or `always_hold`

## High-risk actions now covered

- `redbox_profile_doc(action=update)`
- `redbox_mcp(action=save|disconnect|disconnect_all|discover_local|import_local|call)`
- `redbox_skill(action=create|save|enable|disable|market_install|test_connection|fetch_models)`
- `redbox_runtime_control(action=runtime_query|runtime_resume|runtime_fork_session|tasks_create|tasks_resume|tasks_cancel|background_tasks_cancel)`

## Audit records

Every guarded tool call now writes a `CapabilityAuditRecord` into store state.

Each record includes:

- actor
- runtime mode
- entry kind
- session id
- tool name and action
- approval level
- outcome: `allowed`, `blocked`, or `failed`
- reason
- capability fingerprint
- argument summary
- timestamp

The latest audit rows are surfaced through `debug:get-runtime-summary`.

## Diagnostics surfaces

- `runtime.context_bundle` checkpoints now embed `capabilitySet`
- runtime warm summary now includes per-mode `capabilitySet`
- developer diagnostics now shows:
  - runtime warm capability sets
  - recent capability audits
  - capability scopes inside context bundle checkpoints
