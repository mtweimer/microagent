# TypeAgent Review Notes (March 4, 2026)

Repo reviewed: `https://github.com/microsoft/TypeAgent/tree/main` (cloned locally).

## Confirmed components

- Dispatcher exists and is central to CLI/Shell flow.
  - Source: `TypeAgent/ts/packages/dispatcher/dispatcher`
  - Docs: `TypeAgent/docs/content/architecture/dispatcher.md`
- Structured memory via KnowPro / conversation-memory.
  - Source: `TypeAgent/ts/packages/knowPro`, `TypeAgent/ts/packages/memory`
  - Docs: `TypeAgent/docs/content/architecture/memory.md`
- Translation cache exists and is integrated with explainers/constructions.
  - Source: `TypeAgent/ts/packages/cache`
- CLI interface exists and demonstrates the interaction model.
  - Source: `TypeAgent/ts/packages/cli`

## Model/provider observations

- `aiclient` supports OpenAI + Azure OpenAI directly.
- `aiclient` includes Ollama support (`ollama` provider and OpenAI-compatible local endpoint mode).
- Anthropic appears in `kp` package via `@anthropic-ai/claude-agent-sdk` fallback, not as a first-class dispatcher-wide provider abstraction.

## Microsoft Graph coverage in repo

- Implemented agents: Calendar + Email (Outlook) with Microsoft Graph integrations.
  - Source: `TypeAgent/ts/packages/agents/calendar`, `TypeAgent/ts/packages/agents/email`
- Provider abstraction exists for calendar/email and supports alternate providers (e.g., Google), which is useful for adapter design.
  - Source: `TypeAgent/ts/packages/agents/agentUtils/graphUtils`

## Gap check for requested surfaces

- No direct built-in Teams agent found.
- No direct built-in SharePoint agent found.
- No direct built-in OneDrive agent found.

## Implication for micro-claw

- Reuse dispatcher/cache/memory patterns directly.
- Start with CLI and Graph-ready agent boundaries.
- Build Teams/SharePoint/OneDrive as new agents on top of a shared Graph SDK layer.
