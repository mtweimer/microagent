# Roadmap

## Phase 0 (done)

- Minimal CLI and dispatcher scaffold
- Basic cache + memory + benchmark harness

## Phase 1 (mostly done in this implementation)

- Command-based launch workflow: `run/doctor/profile/bench`
- Profile system and validation
- Provider/model gateway wiring (Ollama/OpenAI/Azure OpenAI/Anthropic)
- Typed action translation + schema validation in dispatcher
- File-backed translation cache
- Local Structured RAG-style SQLite memory backend
- Outlook + Calendar domain execution stubs

## Phase 1 remaining

- Replace Outlook/Calendar stubs with live Microsoft Graph execution
- Persist and reload session-level command state (`/session save/load/new`)
- Add translation cache explainer/construction generation loop

## Phase 2

- Teams agent
- SharePoint agent
- OneDrive agent
- Role/source segmented memory retrieval
- Postgres memory adapter

## Phase 3

- Read-only local system tooling agent
- Multi-modal ingestion/output
- CI regression gates for reasoning/memory/cache benchmarks
