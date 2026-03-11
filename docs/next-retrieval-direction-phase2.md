# Next Retrieval Phase Direction: Planner and Ranker Tuning

Repository: `mtweimer/microagent`  
Branch foundation already in place: `feat/retrieval-v2-cutover`  
Relevant commits:
- `ad13caf` — retrieval v2 engine cutover
- `a6fb127` — cache key + write-back ordering fix

## Decision

Proceed with the next retrieval phase by focusing on **planner and ranker tuning before traversal**.

Do **not** move directly into drill-down / drill-out / fan-out loops yet.

The current branch has the right structural cutover:
- retrieval is now a first-class subsystem
- dispatcher/composer boundaries are improved
- cache keying is consistent
- current-turn assistant write-back contamination is fixed
- regression coverage exists for the two key correctness issues

That means the next highest-value work is to improve **retrieval quality**, not retrieval complexity.

---

## Why this is the right next phase

The system now has a good retrieval spine:
- planner
- engine
- gatherers
- ranker
- diversity policy
- context packer
- dispatcher wiring
- review orchestration hooks

What it does **not** yet have is enough calibration to guarantee consistently strong context selection across Microsoft-heavy use cases.

Right now the biggest quality gains will come from:
- choosing the right sources for each request
- scoring evidence more accurately
- observing what gets packed vs ignored
- validating retrieval behavior with real benchmark prompts

Adding traversal too early would make it harder to reason about failures.

---

## Phase goal

Improve retrieval precision, source selection, and answer-pack quality so the system is reliably useful for:
- Outlook follow-up and recall
- Teams thread/context reconstruction
- project/client/account context lookup
- Microsoft identity / Graph-oriented investigation prompts
- timeline and contextual review requests

---

## Success criteria

This phase is successful when:

1. Exact requests reliably surface exact evidence first.
2. Contextual requests include the most useful surrounding context without stuffing irrelevant items.
3. Cache evidence does not dominate better live evidence.
4. Entity-aware matches outrank loose lexical matches consistently.
5. Debug traces make it obvious why a piece of evidence was selected.
6. A small benchmark suite shows stable improvements as ranker/planner tuning changes are made.

---

## Scope of work

## 1. Add retrieval trace visibility

Make retrieval behavior easy to inspect during local testing.

### Add or expose:
- selected gatherers
- planner output
- score breakdown by item
- selected evidence ids
- overflow evidence ids
- token contribution by source
- counts by source
- latency by gatherer

### Recommended output modes
- CLI debug flag such as `--debug-retrieval`
- optional JSON trace dump
- compact human-readable summary in dev mode

### Why this matters
You should be able to answer:
- why was this evidence selected?
- why was this good evidence ignored?
- which source is dominating?
- how much context budget was spent where?

---

## 2. Build an anecdotal benchmark set

Before tuning aggressively, create a benchmark pack of representative prompts.

### Target size
Start with **20 to 30 prompts**.

### Benchmark categories

#### Outlook / follow-up
- "search my email for invoices from microsoft"
- "what did they want in the last email from Valeo"
- "did I miss anything important in my inbox today"

#### Teams / collaboration
- "show recent Teams messages about Valeo"
- "did anyone ask me for anything in Teams today"
- "what was the latest Teams discussion about guest access"
- "show the exact message from John about guest users"

#### Contextual / review
- "what do we know about Valeo"
- "what happened around the guest access issue this week"
- "summarize the recent context for this project"

#### Microsoft / identity / graph-oriented
- "what context do we have on this app registration"
- "what do we know about this service principal"
- "show context around guest access permissions"
- "what changed around this user or group recently"

#### Compare / timeline
- "compare what we know about client A vs client B"
- "what happened before and after this thread"
- "what happened this week around the account review"

### For each benchmark prompt, record:
- prompt text
- intended retrieval intent
- expected entities
- expected preferred sources
- expected strong evidence
- likely failure modes
- pass/fail notes after each tuning pass

---

## 3. Tune planner source selection

The planner is currently a good baseline, but still heuristic and intentionally shallow.

### Improve intent-to-source mapping

#### Exact requests should bias toward:
- session refs
- Teams index
- cache only when truly appropriate
- direct exact artifacts over summaries

#### Contextual requests should bias toward:
- structured memory
- narrative memory
- entity graph
- relevant artifact source if domain is obvious

#### Timeline requests should bias toward:
- narrative memory
- timestamped Teams artifacts
- session refs when recent references matter

#### Comparative requests should bias toward:
- entity graph
- structured memory
- grouped evidence by entity rather than one flat pool

### Specific planner tasks
- reduce over-inclusion of sources when they are unlikely to help
- make Teams / Outlook / review prompts more source-aware
- make entity-bearing prompts bias entity graph earlier
- reserve cache for cases where cached responses are likely useful rather than generic

### Deliverable
A planner that is still simple, but makes clearly better source choices across the benchmark set.

---

## 4. Tune ranking behavior

The ranker is now the biggest retrieval-quality lever.

### Areas to tune

#### Entity match quality
Boost evidence when:
- entity name appears in `entityRefs`
- entity appears in title
- entity appears in snippet
- exact alias match exists
- domain object identity is strong

#### Precision over generic lexical hits
Down-rank:
- generic memory turns
- broad summaries with no entity tie
- low-information cache responses
- automated/noisy content unless explicitly requested

#### Source reliability calibration
Revisit source weights so that:
- cache does not crowd out exact artifacts
- narrative memory does not beat exact thread/message matches for exact queries
- entity graph helps contextual discovery without burying concrete evidence
- session refs help continuity without overwhelming better evidence

#### Recency calibration
Recency should matter more for:
- timeline
- recent activity review
- “latest” queries

Recency should matter less for:
- durable project context
- stable identity/app context
- long-lived client/entity relationships

#### Diversity behavior
Keep diversity, but tune it so:
- it prevents single-source domination
- it does not suppress the best 2–3 items from one genuinely relevant source

### Deliverable
A ranker that produces better top-k evidence for the anecdotal benchmark pack.

---

## 5. Add a small set of targeted regression tests

The current regression coverage is solid for cutover correctness. Add a few more tests for quality behavior.

### Recommended tests

#### Planner behavior
- exact prompt includes exact-artifact-friendly sources
- contextual prompt includes narrative/entity sources
- timeline prompt biases recent/timestamped sources

#### Ranking behavior
- exact entity match beats generic lexical hit
- exact Teams artifact beats broad narrative summary for exact query
- contextual query can include narrative/entity evidence over weak exact cache hit
- cache evidence does not outrank stronger exact evidence by default

#### Packing behavior
- answer pack favors highest-signal items
- overflow retains useful follow-up evidence
- one noisy source does not fill the whole pack

---

## 6. Add developer-friendly retrieval inspection commands

This is optional but high value.

### Useful commands
- `npm run retrieval:bench`
- `npm run retrieval:trace -- "show recent Teams messages about Valeo"`
- `npm run retrieval:compare -- --case valeo-review --model modelA --model modelB`

### Why this matters
You want retrieval quality to be something you can inspect quickly and repeatedly, not only infer from final answers.

---

## Recommended anecdotal tests to run manually

These are the best “feel test” prompts to run after every meaningful tuning change.

### Repeat-query cache behavior
Run the same query twice:
- "search my email for invoices from microsoft"

Check:
- second run should feel faster or more cache-aware
- cache evidence should not overwhelm better evidence
- changing model/composer settings should not incorrectly reuse old cache keys

### Follow-up continuity
Run:
- "show recent Teams messages about Valeo"
- then: "what about the latest one?"
- then: "did they ask for anything?"

Check:
- session continuity feels coherent
- evidence still points at real prior artifacts
- follow-up does not drift into generic memory summaries

### Contamination sanity
Run a retrieval-heavy action, then:
- "summarize what you found"

Check:
- retrieval does not just surface the assistant’s own prior phrasing
- memory evidence looks like prior facts/artifacts, not response echo

### Source balance
Run:
- "what do we know about Valeo"
- "did I miss anything about the project this week"
- "what context do we have around this account"

Check:
- answer pack is not dominated by a single source
- evidence mix feels deliberate and useful

### Exact vs contextual split
Compare:
- "show the exact Teams message from John about guest access"
- "what was going on around the guest access conversation"

Check:
- exact request favors exact artifacts
- contextual request favors broader surrounding evidence

### Stale vs fresh evidence
Seed older matching memory and fresher exact evidence.

Check:
- fresher, more precise evidence wins when it should
- old generic notes do not crowd out current relevant context

### No-hit behavior
Run a query with weak or no results.

Check:
- system avoids stuffing irrelevant evidence just to fill the pack
- fallback behavior remains honest and useful

---

## Suggested implementation order

1. Expose retrieval trace/debug visibility
2. Create the 20–30 prompt anecdotal benchmark set
3. Tune planner source-selection rules
4. Tune ranking weights and diversity behavior
5. Add quality regression tests
6. Re-run benchmark pack and record improvements
7. Only after that, begin traversal design

---

## What not to do yet

Avoid these until planner/ranker tuning is in better shape:
- traversal loops
- aggressive fan-out
- embeddings everywhere
- autonomous multi-hop exploration
- model reranking as a first fix
- per-agent custom retrieval logic that bypasses the shared engine

The goal right now is to make the shared retrieval core dependable.

---

## Exit criteria before traversal

Do not begin drill-down / drill-out / fan-out until these are true:

- planner choices look sensible across benchmark prompts
- answer packs are consistently useful
- exact vs contextual behavior is visibly different
- cache behavior is stable and not distorting results
- retrieval traces are easy to inspect
- benchmark results give you confidence that changes are improving quality

---

## Recommended next PR focus

Title suggestion:

`planner-ranker-tuning-v1`

### Likely contents
- retrieval trace/debug output
- anecdotal benchmark definitions
- planner source-selection improvements
- ranker weight adjustments
- additional regression tests for retrieval quality

---

## Bottom line

The retrieval-v2 cutover is now solid enough to build on.

The next step should be:
**make retrieval smarter before making it deeper.**

That means planner and ranker tuning first, then traversal once evidence selection is consistently strong.