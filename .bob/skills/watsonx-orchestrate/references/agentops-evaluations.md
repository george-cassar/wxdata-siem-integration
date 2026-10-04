# AgentOps — evaluating & observing wxO agents

The **AgentOps** layer is how you measure agent quality (evaluations) and inspect agent
behavior (observability/traces). It complements the §3.6 single/multi-turn smoke gate
with repeatable, metric-driven testing — use it before promoting an agent or after any
change that could regress behavior.

> **Install requirement (verified 2.12.0):** the evaluation *engine* ships as an extra,
> not in the base install. The `orchestrate evaluations …` CLI commands exist either way,
> but without the extra they fail at runtime with `ModuleNotFoundError: No module named
> 'agentops'`. Install it first:
> ```bash
> pip install "ibm-watsonx-orchestrate[agentops]"        # or:
> uv pip install --python .venv/bin/python "ibm-watsonx-orchestrate[agentops]"
> ```
> **watsonx.ai credentials are conditional, not a hard prerequisite.** The framework calls
> an LLM as judge / to synthesize tests, and `validate-native` runs
> `validate_watsonx_credentials` — but on a **stock IBM Cloud SaaS instance it resolves
> against the tenant's own model and needs no `.env` at all** (live-verified 2.13.0:
> `validate-native` completed 3 evaluations with no `.env` present). Add watsonx.ai creds to
> `.env` only if your tenant is configured such that the run actually fails on credentials.
> Do not let a missing `.env` stop you from trying.

---

## 1. The evaluations CLI (verified flags, 2.12.0)

`orchestrate evaluations <cmd>` — runs against the **active env**:

| Command | What it does | Key flags |
|---------|--------------|-----------|
| `generate` | Synthesize test cases from user stories | `--stories-path/-s` (CSV, **required**), `--tools-path/-t` (**required**), `--output-dir/-o`, `--env-file/-e` |
| `quick-eval` | Score an agent on static + LLM-as-judge metrics | `--config/-c` (YAML), `--test-paths/-p` (comma-sep), `--tools-path/-t`, `--output-dir/-o`, `--env-file/-e` |
| `evaluate` | Full eval against a set of test cases | `--config/-c` (YAML), `--test-paths/-p`, `--output-dir/-o`, `--env-file/-e` |
| `analyze` | Analyze a finished eval run | `--data-path/-d` (**required**), `--tools-path/-t`, `--mode/-m` `default\|enhanced` |
| `record` | Record chat sessions → test cases | (interactive) |
| `validate-native` | Validate a native agent against inputs | `--tsv/-t` (**required**), `--output/-o` (default `./test_native_agent`), `--env-file/-e` |
| `validate-external` | Validate an external agent | `--tsv/-t`, `--output/-o`, … |
| `red-teaming` | Generate + run adversarial attacks | see `--help` |

Always confirm with `orchestrate evaluations <cmd> --help` for your version.

## 2. Input formats (verified from source)

**`validate-native` / `validate-external` — TSV** (tab-separated, one test per line):
```
<user story / goal>	<expected final outcome>	<agent_name>
```
- Column 1 = the user's goal/story, column 2 = expected outcome, column 3 = the
  **snake_case agent `name`** (not display name). `validate-native` synthesizes a
  performance test from each row, then runs the evaluation.

> ⚠ **Column 2 is mined for keywords, and the answer must contain them LITERALLY.**
> This is the single biggest trap in `validate-native` (live-verified 2.13.0). The framework
> extracts keywords from your expected-outcome text into the generated test case, e.g.
> `"Identifies the major CYP2C9 interaction and delegates to immunology"` →
> `"keywords": ["CYP2C9", "immunology"]`. If the agent identifies the interaction correctly
> but *describes the mechanism in its own words*, `keyword_match` is `0.0`, `is_success` is
> `False`, and the report says `"Matched 0/1 text goals"` — for a perfectly good answer.
>
> Two rules that follow:
> 1. **Write expected outcomes in the agent's own vocabulary.** Run the prompt once, read
>    the answer, then write column 2 using words it actually emits.
> 2. **Trust `Orchestrate Agent Routing F1` over the `*_match` metrics.** It is computed
>    from actual delegation behaviour, not string matching, so it is unaffected by phrasing.
>    A useful sanity check: rewording column 2 should move `keyword_match` and leave routing
>    F1 **unchanged** — if routing F1 moves, your rewording changed the agent's behaviour,
>    not just the grading.

**`generate` — stories CSV** with **`story` and `agent` columns**:
```csv
story,agent
"Ask for a differential for fever and a rash",dr_house_advise
"Ask who Wilson is",dr_house_advise
```
Plus `--tools-path` pointing at the directory holding the tool source `.py` files.

**`quick-eval` / `evaluate` — a YAML `--config`** + `--test-paths` (test-case JSON files
or dirs) + `--tools-path`. Generate the test cases first with `generate`, or hand-author
them, then point `--test-paths` at the output directory.

## 3. Typical workflow

```bash
# 0) one-time: install the engine
pip install "ibm-watsonx-orchestrate[agentops]"

# 1) generate test cases from user stories
orchestrate evaluations generate -s stories.csv -t ./tools -o ./eval/generated

# 2) run the evaluation (static + LLM-judge metrics)
orchestrate evaluations evaluate -p ./eval/generated -t ./tools -o ./eval/results
#    or a fast pass:
orchestrate evaluations quick-eval -p ./eval/generated -t ./tools -o ./eval/results

# 3) analyze (enhanced adds tool-level enrichment)
orchestrate evaluations analyze -d ./eval/results -t ./tools -m enhanced

# Fast path for a native agent without authoring JSON test cases:
orchestrate evaluations validate-native --tsv native_tests.tsv -o ./eval/out
```
Results (metrics, per-test pass/fail, judge rationales) are written under `--output-dir`.

### What the output looks like (live-verified 2.13.0)

```
<output-dir>/native_agent_evaluations/
├── generated_test_data/<name>.json          the synthesized test case (incl. extracted keywords)
└── <YYYY-MM-DD_HH-MM-SS>/
    ├── average_metrics.json                 metrics averaged across runs
    ├── summary_metrics.csv                  one row per test — the file to read first
    ├── <name>.metadata.json                 { "thread_id": … } — join key to the trace
    ├── config.yml
    └── messages/<name>.messages.json        full transcript + per-test metrics
```

`average_metrics.json`:

```json
{ "Runs": 1.0,
  "Orchestrate Agent Routing F1": 0.67,     // ← the behavioural metric; trust this one
  "Total Steps": 6.0,  "LLM Steps": 3.0,
  "Average Agent Response Time (s)": 2.24,
  "Total Tool Calls": 1.33, "Tool Match Success": 1.0,
  "Correct Tool Calls": NaN, "Tool Call Recall": NaN, "Tool Parameter F1": NaN,
  "Keyword Match": 0.0, "Semantic Match": 0.0, "Text Match": 0.0,
  "Journey Success": 0.0 }
```

Reading it:

| Metric | What it means | Trust it? |
|---|---|---|
| `Orchestrate Agent Routing F1` | did the request reach the right agent | **yes** — behavioural |
| `Tool Match Success` / `Tool Call Recall` / `Precision` | expected vs actual tool calls | yes, **if** you declared expected tools; `NaN` otherwise |
| `Total Steps` / `LLM Steps` / `Average Agent Response Time` | cost & latency proxies | yes, descriptive |
| `Keyword Match` / `Text Match` | literal string overlap | **no** — see the §2 warning |
| `Semantic Match` | LLM-judged similarity | with care |
| `Journey Success` | all goals met | only as good as your column 2 |

`NaN` means *not applicable* (nothing was declared to compare against), not *failed* —
`np.nanmean` over an all-`NaN` column also emits a harmless
`RuntimeWarning: Mean of empty slice`.

## 4. Observability / traces (the "Ops" half)

Evaluations tell you *how well*; traces tell you *why*. Every `/v1/orchestrate/runs`
response carries a `trace_id` — capture it, it is the only handle you get.

### 4a. Three surfaces, three levels of detail — pick deliberately

| Surface | How | Gives you |
|---|---|---|
| **Runs API** | `GET /v1/orchestrate/runs/{run_id}` | `status`, `trace_id`, `thread_id`, `started_at`/`completed_at`, `step_history` (tool calls + responses), and since **2.18.0** run-level **`usage`** (`token_usage` + per-model `model_usage[]`, incl. `cached_tokens`; it was `null` on 2.13.0). **No per-step timing.** |
| **CLI export** | `orchestrate observability traces export --trace-id <id>` | **11** observation fields — enough for a quick look and for token counts. **No `latency`** (subtract the timestamps), **no `parentObservationId`**. |
| **AgentOps v3 API** | `GET /v1/agentops-v3/traces/{trace_id}` | Those 11 **plus ~30 more** — `latency`, the span tree, error level, cost fields, and the trace-level `scores[]`. |

> **Rule of thumb: CLI export for a quick look or a token count; AgentOps v3 for anything
> that has to *explain* a number.** Without `parentObservationId` you cannot tell a 6-second
> outer span wrapping a 2-second inner one (platform cold start) from genuinely slow work —
> and that distinction is most of latency debugging (§4d).

```bash
# search (relative window / user / session), then export by trace-id
orchestrate observability traces search --last 30m                   # or --start-time/--end-time
orchestrate observability traces search --last 3h --user-id <u> --session-id <s>
orchestrate observability traces export --trace-id <trace_id> -o trace.json
# the rich one:
curl -H "Authorization: Bearer $TOKEN" "<instance-url>/v1/agentops-v3/traces/<trace_id>"
```

**Re-verified on 2.15.0 (SaaS):** `traces search --last 1h` returns real runs with agent
names and latencies, and `traces export --trace-id` reports the observation count it wrote.
A run against a two-knowledge-base agent produced 13 observations including one named per
KB (`ppth_formulary`, `ppth_policy`) — a quick way to confirm multi-KB retrieval actually
happened rather than trusting the answer text.

**2.13.0 traces overhaul (live-verified):** `export` returns **observations** —
`{observations:[…], total_count, exported_at, format, trace_id}` — instead of spans.
`search` gains **`--last`** and filters by `--user-id`/`--session-id`; the old
`--service-name`/`--agent-name`/`--agent-id`/`--min-spans`/`--max-spans` are deprecated.
**`search --last` now returns results on SaaS** (it returned 0 in 2.12.0). Sensitive
(masked) flow values are redacted in traces.

> ⚠ Two things that mislead in `traces search` output (live-verified 2.13.0):
> - The results table **still renders a populated `Agent Name` column** even though
>   `--agent-name` is a deprecated no-op. It is very easy to believe the filter worked.
>   **Filter client-side.**
> - The results mix **sub-second infrastructure traces** (blank agent name, ~200–450ms) in
>   with real agent runs. Any error-rate or latency statistic must exclude them or it is
>   meaningless.

### 4a-bis. Traces from agents that run OUTSIDE wxO (2.14 → 2.15)

An agent running on your own infrastructure can push its traces **into the same Agent
Analytics dashboard**, so external and native agents appear side by side. Both routes below
are **doc-sourced, not live-verified in this skill's test round** — treat them as a starting
point and confirm before quoting them to a customer.

**Route 1 — OpenTelemetry (any framework, any language with an OTel SDK).**
```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```
| Piece | Value |
|---|---|
| Endpoint | `<instance-url>/v1/orchestrate/inject/traces` (OTLP/HTTP) |
| Auth | `Authorization: Bearer <token>` — exchange the API key at the IAM/MCSP token endpoint |
| `TENANT_ID` | `<account-id>_<instance-id>` |
| `AGENT_ID` | the registered agent id |
| `ENVIRONMENT_NAME` | `draft` or `live` |
| `OTEL_RESOURCE_ATTRIBUTES` | `tenant.id=$TENANT_ID,deployment.environment=$ENVIRONMENT_NAME` |
| Root-span attributes | `agent.id`, `langfuse.session.id` (new UUID per conversation), `langfuse.user.id` (`usr_`-prefixed) |

**Always `force_flush()` before the process exits** or the final trace is dropped.
Because the transport is plain OTLP, the same instrumentation can fan out to Jaeger or
Instana at the same time.

**Route 2 — the Observability SDK (decorator-based, aimed at LangGraph).**
```bash
pip install -i https://test.pypi.org/simple/ ibm-watsonx-orchestrate-sdk   # Test PyPI pre-release
```
```python
from ibm_watsonx_orchestrate_sdk.client import Client
from ibm_watsonx_orchestrate_sdk.observability import Tracer, TracerConfig, register_tracer
from ibm_watsonx_orchestrate_sdk.observability.decorators import (
    configure_tracing, trace_agent_call, trace_llm_call, trace_tool_call, trace_call,
)

client = Client(api_key=API_KEY, instance_url=INSTANCE_URL)
config = TracerConfig(client=client, agent_id=AGENT_ID, workspace_id=WORKSPACE_ID,
                      environment="live", tenant_id=TENANT_ID)  # tenant_id: IBM Cloud only
register_tracer(Tracer(config))          # once, at module load
```
Then decorate: `@configure_tracing` on the graph factory, `@trace_agent_call` on the
top-level node, `@trace_llm_call` / `@trace_tool_call` on LLM and tool calls, `@trace_call`
on helpers. Token refresh, root-span creation, tool attributes and PII decorators are
handled for you.

⚠ **The SDK is a separate package from `ibm-watsonx-orchestrate`, and it ships from Test
PyPI.** Pin the version and re-check the package name before it goes anywhere near a
customer build.

### 4b. Field map (AgentOps v3) — note the camelCase

Every other payload in wxO is snake_case; **this one is camelCase**, so the natural guesses
(`start_time`, `total_cost`) silently return `None`.

**Trace level:**
`latency` · `totalCost` · `scores[]` · `sessionId` · `userId` · `environment` · `timestamp` ·
`name` · `input` · `output` · `metadata` · `observations[]` · `htmlPath` · `id` · `tags`

**Observation level** (41 fields; the ones that matter):

| Field | Notes |
|---|---|
| `type` | `CHAIN` \| `GENERATION` \| `SPAN` |
| `name` | tool name, `WatsonxChatModel.chat`, `load_skill`, `collaborator`, `LangGraph`, … |
| `latency` | seconds, precomputed — **v3 API only** |
| `startTime` / `endTime` | ISO 8601 (present in the CLI export too) |
| `usage.{input,output,total}` | **tokens — populated on `GENERATION` only** |
| `model` | e.g. `openai/gpt-oss-120b` — needed to price the tokens |
| `parentObservationId` | **the only way to rebuild the span tree** — v3 API only |
| `level`, `statusMessage` | per-span error state — v3 API only |
| `timeToFirstToken` | streaming responsiveness |
| `calculatedInputCost` / `calculatedOutputCost` / `calculatedTotalCost` / `inputPrice` / `outputPrice` / `totalPrice` / `costDetails` / `usagePricingTierName` | present — and **all zero/empty**, see §5 |

Only the **11** fields `id · traceId · type · name · model · input · output · usage ·
startTime · endTime · metadata` appear in the CLI export. Everything else is v3-API-only.

### 4c. Useful trace names to recognise

- `LangGraph` — the top-level agent graph; its latency ≈ the whole run
- `collaborator` / `LangGraph[collaborator:<uuid>]` — a **delegation**; the sub-agent's whole
  execution is nested here and flattened into the parent trace
- `WatsonxChatModel.chat` — one LLM call; the **only** observation type carrying tokens
- `load_skill` — an attached agent skill being fetched at runtime (see SKILL.md §3.3c)
- `runtime.invoke_tool` / `POST /api/v1/runtime/tools/:toolId/run` / `POST /execute` — the
  tool-runtime call chain wrapping your tool's own span

### 4d. Diagnosing latency from a trace

Sort observations by `latency` descending, then rebuild the tree with
`parentObservationId` and apply one rule:

> **Outer span ≫ inner span → the time is in the *platform*** (cold start, queueing,
> transport). **Outer ≈ inner → the time is in *your code*** or the system it calls.

Those two have completely different fixes. A real example (live-verified): a tool whose
outer span was `6.368s` but whose inner span was `1.807s` — a 4.5s gap that was container
cold start, not the tool. The same tool later in the session ran in a fraction of the time.
Meanwhile a genuinely slow tool showed `4.862s` outer against `4.506s` inner — that time was
real work.

Also split the run three ways to know where to even look:
- sum of `GENERATION` latencies = LLM time
- sum of tool-name `SPAN` latencies = tool time
- remainder = orchestration & delegation overhead

It is common for the LLM to be a small minority of a slow run.

## 5. Cost and tokens — tokens are native, **money is not**

**Token counts are exact and native.** Sum `observation.usage.input` / `.output` over
`GENERATION` observations.

**Cost is not computed.** On a stock SaaS instance `trace.totalCost` and every
`calculatedTotalCost` return **`0`** — the pricing-tier fields exist but no price sheet is
attached (live-verified 2.13.0). Reporting `$0.00` from that field is wrong by exactly the
whole bill.

```
tokens  → native, exact, per LLM call
price   → yours: keep a rate card keyed by observation.model and multiply
```

Two findings worth repeating to anyone sizing a deployment:

- **Input tokens dominate.** A measured 9-run multi-agent session was ~**9:1** input to
  output (135,746 in / 15,415 out). Context re-sent on every delegation, loaded agent skills
  and tool results fed back in are the bulk of the bill — optimising answer length optimises
  the small side.
- **Delegation is not free.** A collaborator gets its own system prompt, context and
  generation calls, all flattened into the parent trace. Multi-agent routing quality costs
  tokens, and the number is measurable — compare a self-answered run with a delegated one.

Group by `trace.sessionId` (and `trace.userId`) for session- and tenant-level roll-ups.

## 6. Quality scores the control plane attaches by itself

`trace.scores[]` is populated asynchronously by a control-plane evaluation job:

```json
{ "name": "hallucination", "value": 0.85, "source": "EVAL",
  "comment": "The answer invents extensive clinical details … that were never provided in
              the query, creating a plausible but unfounded scenario …" }
```

Two behaviours that both cause wrong conclusions (live-verified 2.13.0):

- **It is asynchronous and it SAMPLES.** One trace was scored ~30s after the run; nine other
  traces from the same session re-fetched minutes later had **zero** scores. Never block a
  gate on a score arriving, and never report "no hallucinations detected" when the truth is
  "nothing in this batch was sampled".
- **It scores the final answer against the user query, with tool output out of scope.** So a
  **correct, tool-grounded answer scores as a hallucination** — the 0.85 above was awarded to
  an answer whose "invented" specifics had all been read from a record by a tool. This is the
  default failure mode of automated hallucination scoring on **tool-using agents**. Do not
  wire it to an alert without accounting for it.

**When you need a defensible number**, prefer an *in-graph observer*: a collaborator agent
whose rubric weights live in a **`@tool`** (so the same answer always scores the same) and
whose criteria reference retrieved evidence. Its verdict lands in `step_history`, making it
auditable. Native judges are for triage across volume; a rubric observer is for a claim you
have to stand behind.

## 7. Native vs derive — the boundary to state out loud

| Signal | Native? | Where |
|---|---|---|
| End-to-end latency | **native** | `trace.latency` |
| Per-step latency | **native** | `observation.latency` (v3 API only) |
| Token counts | **native** | `observation.usage.*` on `GENERATION` |
| Model identity | **native** | `observation.model` |
| Session / caller | **native** | `trace.sessionId`, `trace.userId` |
| Span tree | **native** | `observation.parentObservationId` (v3 API only) |
| Sampled quality scores | **native** | `trace.scores[]` (§6 caveats) |
| Routing accuracy | **native** | `Orchestrate Agent Routing F1` from `evaluations` |
| Tokens on the runs API | **native since 2.18.0** (run totals) | `run.usage.token_usage`; per-call detail still only in the trace |
| **Cost** | **derive** | tokens × your rate card (§5) |
| **Error rate** | **derive** | runs not `completed` ÷ total (exclude infra traces) |
| **Tail latency** | **derive** | percentiles over a window of traces |
| **Tool-call success** | **derive** | inspect each `tool_response` for an error payload |
| **Dashboards** | **none ship** | error rate / latency histogram / tool success are all customer-built |

> **There is no built-in operations dashboard in wxO.** No error-rate panel, no latency
> histogram, no tool-success view. The control plane gives you the raw material; the panel is
> yours to build. This is a scoping fact — state it before a customer assumes otherwise.

## 8. When to reach for what

- **Quick confidence after a change** → §3.6 single + multi-turn smoke gate (no extra needed).
- **Repeatable quality bar / regression suite** → `generate` + `evaluate`/`quick-eval`.
- **Is it routing to the right agent?** → `validate-native` → `Orchestrate Agent Routing F1`.
- **Adversarial / safety** → `red-teaming`.
- **Root-cause a bad answer** → `traces export --trace-id` (quick) / AgentOps v3 API (deep).
- **"Why did this take 20 seconds?"** → AgentOps v3 + the outer-vs-inner span rule (§4d).
- **"What will this cost at volume?"** → sum `observation.usage`, apply your own rate card (§5).
- **Online quality you can defend** → an in-graph observer agent with a rubric in a tool (§6),
  not the native hallucination judge.
- **Ops dashboards** → build them; none ship (§7).

> Runnable patterns: the public `examples/evaluations/` directory
> (https://github.com/IBM/ibm-watsonx-orchestrate-adk/tree/main/examples/evaluations) —
> evaluate, generate, analysis, red-teaming, rubric_evals, quick-eval, with-context-variable.
