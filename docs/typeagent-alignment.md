# TypeAgent Alignment (micro-claw)

This codebase now mirrors the TypeAgent package pattern for domain agents while keeping the existing CLI dispatcher architecture.
Source files are authored in TypeScript. Some imports still use `.js` module specifiers because the repo targets Node ESM with `moduleResolution: "NodeNext"`, where TypeScript source points at the emitted runtime path.

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
  - `src/agents/ms/outlookAgent.ts`
  - `src/agents/ms/calendarAgent.ts`
- Runtime catalog:
  - `src/agents/catalog.ts`
  - manifest-driven discovery + dynamic module loading
- Dispatcher:
  - `src/core/dispatcher.ts`
  - capability-grounded routing + clarification + retrieval planning
- Structured memory:
  - `src/core/sqliteMemory.ts`
  - `src/core/memory.ts`
  - `src/core/narrativeMemory.ts`
- Structured response composer:
  - `src/core/promptAssembler.ts`
  - `src/core/responseComposer.ts`

## Standard for future agents

Every new domain should follow this exact package shape:

1. `src/agents/<domain>/manifest.json`
2. `src/agents/<domain>/actions/*.ts`
3. `src/agents/<domain>/index.ts`
4. optional `src/agents/<domain>/memory/*.ts`
5. compatibility export under `src/agents/ms/*Agent.ts`
6. registry contract in `src/contracts/actionRegistry.ts`
7. schema generation + tests

This keeps tool mapping deterministic, testable, and consistent across all subagents.

## Dispatcher pipeline modules

To reduce monolith coupling, dispatcher helpers are extracted into:

- `src/core/dispatcherPipeline/domainResolution.ts`
- `src/core/dispatcherPipeline/sessionRefs.ts`
