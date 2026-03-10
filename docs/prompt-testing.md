# Prompt Testing (Risk-Gated)

Use automated prompt tests in `simulate` mode by default so no real Graph mutation happens.

## Run smoke suite safely

```bash
npm run prompt:test
```

Default behavior:
- `--mode simulate`
- `--allow-risk low`
- Suite: `benchmarks/prompt-suites/smoke.json`

With `allow-risk low`, medium/high-risk cases are skipped.
The runner also infers risk from translated action and blocks any case where inferred risk exceeds `--allow-risk`.

## Run broader risk levels in simulate mode

```bash
npm run prompt:test -- --allow-risk medium
npm run prompt:test -- --allow-risk high
```

## Run against a specific provider/model

```bash
npm run prompt:test -- --provider ollama --model llama3.1
```

## Live Graph execution (explicit opt-in)

Only use when you intentionally want real API side effects:

```bash
npm run prompt:test -- --mode live --graph-live --allow-risk medium
```

Notes:
- `--mode live --graph-live` uses configured Graph client.
- `simulate` mode always uses a mock Graph client.
- Risk gate always applies before execution.
