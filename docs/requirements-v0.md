# micro-claw Initial Requirements (v0)

## Product goal

Build a minimal, efficient personal assistant agent that starts in CLI chat mode and evolves into a multi-agent Microsoft ecosystem assistant.

## Non-negotiable principles (copied from TypeAgent)

1. Distill models into logical structures (actions, memory ontologies, tree-of-thought planning).
2. Use structure to control information density.
3. Use structure to enable collaboration among humans/models/programs.

## Functional requirements

1. CLI-first conversational interface.
2. Dispatcher-centric routing to typed agents.
3. Structured memory with retrieval-first behavior (Structured RAG style).
4. Translation cache to reduce repeated LLM calls.
5. Multi-provider model strategy:
   - Local: Ollama
   - Cloud: Azure OpenAI, OpenAI, Anthropic
6. Microsoft-first domain strategy:
   - Phase 1: Outlook email + Calendar
   - Phase 2: Teams + SharePoint + OneDrive
7. Local machine capability roadmap (files, shell/tool actions) behind explicit permissions.
8. Persona overlays via config docs (`agent.md`, `soul.md`).

## Quality requirements

1. Low-latency path on repeated intents (cache hit path).
2. Memory recall quality is measured and tracked over time.
3. Provider/model benchmarks support side-by-side comparison.
4. Agent boundaries are explicit and testable.

## Security and compliance defaults

1. Secrets only through env or secure vault.
2. Graph scopes minimized per agent.
3. All action execution paths auditable.
