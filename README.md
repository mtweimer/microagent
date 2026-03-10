# micro-claw

A minimal personal assistant agent project inspired by Microsoft TypeAgent.

Current implementation includes:
- Structured CLI launch workflow (`run`, `doctor`, `check`, `profile`, `bench`)
- Profile-driven runtime (`profiles/default.json`)
- Slash command interaction model (`/provider`, `/model`, `/graph`, `/memory`, `/cache`)
- Conversational response composer with typed suggested follow-up actions
- Dedicated freeform chat composer path (natural conversation) + structured action-result composer path
- Persona context layering from `config/agent.md`, `config/soul.md`, and generated overlays
- Narrative long-term memory summaries persisted in `data/narrative-<profile>.jsonl`
- Manual multi-provider/model switching (Ollama/OpenAI/Azure OpenAI/Anthropic)
- Dynamic Ollama model discovery via `OLLAMA_ENDPOINT/api/tags`
- Dispatcher pipeline with strict typed action envelopes + schema validation
- LLM-first translation with correction pass + heuristic fallback
- Central canonical action registry with generated per-agent schema files
- Local Structured RAG-style memory backends:
  - SQLite (`node:sqlite`) with term/topic/entity/relation indexing
  - in-memory fallback for lightweight/testing scenarios
- File-backed translation cache
- Outlook + Calendar domain agents with shared execution contract
- TypeAgent-style domain package layout (`src/agents/<domain>/{manifest,actions,index}`)
- Manifest-driven agent discovery/registration from `src/agents/*/manifest.json`
- Scaffolded domains wired for future expansion: Teams, SharePoint, OneDrive, local-system
- Delegated Microsoft Graph auth via device code
- Structured trace schema for consistent debugging

## Quick start

Requirements:
- Node 20+ (Node 22+ recommended for `node:sqlite`)

Setup:
1. Copy `.env.example` to `.env`
2. Set `MSGRAPH_APP_CLIENTID` for Graph login
3. Fill model provider credentials/endpoints as needed
4. Edit `profiles/default.json` if desired
5. Generate schemas: `npm run schema:generate`

## Commands

- `npm run run` or `npm start`
- `npm run doctor`
- `npm run check`
- `npm run profile:list`
- `npm run profile:show`
- `npm run profile:validate`
- `npm run schema:generate`
- `npm run schema:check`
- `npm run plugins:validate`
- `npm run bench`
- `npm test`
- `npm run routing:test`

## `microclaw` shell launcher

Launcher: [scripts/microclaw](/Users/hoplite/Documents/dev/micro-claw/scripts/microclaw)

To use from PATH:
1. `chmod +x /Users/hoplite/Documents/dev/micro-claw/scripts/microclaw`
2. Add `/Users/hoplite/Documents/dev/micro-claw/scripts` to `PATH`
3. Run `microclaw run --profile default`

Helper modes:
- `microclaw up --profile default` (doctor then run)
- `microclaw check --profile default`
- `microclaw plugins validate --profile default`

## Interactive slash commands

- `/provider list|current|use <provider>`
- `/model list|current|use <model>`
- `/graph status|login|whoami|logout`
- `/teams status|probe`
- `/teams search <query> [window=today|48h|7d|30d|all] [surface=chats|channels|both] [depth=fast|balanced|deep|full] [top=1-100] [team=<name>] [channel=<name>] [sender=<name|email>] [since=<iso>] [until=<iso>] [importance=normal|high]`
- `/teams review [window=today|48h|7d|30d|all] [surface=chats|channels|both] [depth=fast|balanced|deep|full] [top=1-100]`
- `/sync teams|teams full|teams delta|status|config`
- `/evidence last`
- `/trace last`
- `/memory query <text>`
- `/memory stats`
- `/memory summarize [today|week|session]`
- `/cache stats|clear|mode [completionBased|nfa]`
- `/review today|missed`
- `/persona show|reload`
- `/suggest apply <id>`
- `/suggest explain <id>`
- `/suggest confirm <id>`
- `/composer status|test <prompt>`
- `/composer prompt [text]`
- `/router explain <text>`
- `/capabilities`
- `/session info`

## Notes

- Graph calls require `/graph login` once token cache is empty/expired.
- Teams retrieval uses chats + channels when permitted; use `/teams probe` to inspect endpoint/scope reachability.
- Agent plugins can be discovered from:
  - `profile.agents.paths` (array of directories)
  - `MICRO_CLAW_AGENT_PATHS` (comma/colon/semicolon separated directories)
- `doctor`/build service summary includes composer wiring status (`enabled/strategy/primaryReady/fallbackReady`).
- Strict fail-closed action validation is enabled.
- Generated schema files under `src/agents/ms/*.schema.generated.json` are not hand-edited.
- Node may print an experimental warning for `node:sqlite`; functionality is still valid.

## Docs

- `docs/typeagent-review.md`
- `docs/requirements-v0.md`
- `docs/agent-catalog.md`
- `docs/typeagent-alignment.md`
- `docs/roadmap.md`
