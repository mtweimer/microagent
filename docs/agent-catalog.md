# Agent Catalog and Organization

This project now uses a TypeAgent-style package layout per domain agent:

- `src/agents/<domain>/manifest.json`
- `src/agents/<domain>/actions/*.js`
- `src/agents/<domain>/index.js`
- `src/agents/<domain>/memory/*.js` (optional)
- compatibility export in `src/agents/ms/*Agent.js`

## Why this structure

- Keeps action handlers, contracts, and routing hints co-located.
- Makes agent growth deterministic (same shape for every new domain).
- Enables drift checks between manifest actions and central registry.
- Simplifies debugging by reducing cross-file hidden behavior.

## Active agent packages

- `ms.outlook` at `src/agents/outlook`
- `ms.calendar` at `src/agents/calendar`

Planned packages follow the same schema:

- `ms.teams`
- `ms.sharepoint`
- `ms.onedrive`
- `local.system`

## Runtime catalog

- Runtime agent bootstrap lives in `src/agents/catalog.js`.
- Agent loading is manifest-driven:
  - discovers `src/agents/*/manifest.json` (excluding `base` and `ms`)
  - dynamically imports each package `entry` (`./index.js` default)
  - instantiates agent from module exports (`createAgent`, `default`, or matching class export)

## External plugin paths

- `profile.agents.paths`: `["/abs/path/to/agent-packages-root"]`
- `MICRO_CLAW_AGENT_PATHS`: `dirA,dirB` (also accepts `:` and `;` separators)

Each plugin package directory should contain:

1. `manifest.json`
2. entry module (default `./index.js`)
3. exported `createAgent()` or default class/factory that returns `{ id, canHandle, execute }`
- `/capabilities` now returns:
  - capability pack (dispatcher-visible)
  - agent catalog (manifest-level package metadata)

## Scaffolded packages

- `ms.teams`:
  - `search_messages`
  - `review_my_day`
  - `search_mentions`
- `ms.sharepoint` (search_documents)
- `ms.onedrive` (search_files)
- `local.system` (inspect_system)

`ms.teams` now executes against Graph chat messages (`/me/chats/getAllMessages`).
SharePoint/OneDrive/local-system remain scaffolded placeholders for next implementation passes.
