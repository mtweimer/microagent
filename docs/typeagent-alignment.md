# TypeAgent Alignment (micro-claw)

This codebase now mirrors the TypeAgent package pattern for domain agents while keeping the existing CLI dispatcher architecture.

## Reference points in local TypeAgent repo

- `TypeAgent/README.md`:
  - typed actions
  - dispatcher-style routing
  - structured memory concepts
- `TypeAgent/ts/packages/agents`:
  - domain-packaged agent organization
  - reusable action/tool boundaries

## micro-claw mapping

- TypeAgent-style domain package:
  - `src/agents/outlook/*`
  - `src/agents/calendar/*`
- Backward-compatible exports:
  - `src/agents/ms/outlookAgent.js`
  - `src/agents/ms/calendarAgent.js`
- Runtime catalog:
  - `src/agents/catalog.js`
  - manifest-driven discovery + dynamic module loading
- Dispatcher:
  - `src/core/dispatcher.js`
  - capability-grounded routing + clarification + retrieval planning
- Structured memory:
  - `src/core/sqliteMemory.js`
  - `src/core/memory.js`
  - `src/core/narrativeMemory.js`
- Structured response composer:
  - `src/core/promptAssembler.js`
  - `src/core/responseComposer.js`

## Standard for future agents

Every new domain should follow this exact package shape:

1. `src/agents/<domain>/manifest.json`
2. `src/agents/<domain>/actions/*.js`
3. `src/agents/<domain>/index.js`
4. optional `src/agents/<domain>/memory/*.js`
5. compatibility export under `src/agents/ms/*Agent.js`
6. registry contract in `src/contracts/actionRegistry.js`
7. schema generation + tests

This keeps tool mapping deterministic, testable, and consistent across all subagents.

## Dispatcher pipeline modules

To reduce monolith coupling, dispatcher helpers are extracted into:

- `src/core/dispatcherPipeline/domainResolution.js`
- `src/core/dispatcherPipeline/sessionRefs.js`
