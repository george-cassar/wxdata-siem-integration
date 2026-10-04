# Testing, evaluating & debugging wxO agents

---

## 1. The fast iteration loop

```bash
orchestrate env activate local
./import-all.sh                  # re-import overwrites by name
orchestrate agents list -v       # confirm presence + wiring
orchestrate chat start           # interactive test in the UI
```

Non-interactive, scriptable test (great for regression checks and CI):
```bash
orchestrate chat ask -n weather_agent "What's the weather in Paris?" -r
#   -r / --include-reasoning   show the reasoning trace
#   -l / --capture-logs        capture execution logs (custom agents)
#   -t / --thread-id <id>      continue an existing conversation
```
> ⚠ **On IBM Cloud SaaS, `chat ask` can hang** (drops into interactive mode / waits on
> stdin and produces no output) — live-observed 2.12.0. For scripted/CI testing against
> SaaS use the runtime API (`/v1/orchestrate/runs`) or `wxo-chat.sh` instead; `chat ask`
> is most reliable against the local Developer Edition.

Snapshot a known-good definition into version control:
```bash
# Agent → YAML. Reimports directly (orchestrate agents import -f <file>).
orchestrate agents export -n weather_agent --kind native -o agents/weather_agent.yaml --agent-only

# Tool → ZIP (a transfer bundle of the source .py + requirements.txt), NOT YAML.
# Use a plain underscore name: a dot in the base name (e.g. get_weather.exported.zip)
# is REJECTED on reimport — "only alphanumeric characters and underscores are allowed".
orchestrate tools export -n get_weather -o tools/get_weather_export.zip
```
**Reimporting a tool zip:** you cannot pass the zip to `tools import` (it tries to load
it as a Python module). Unzip first, then import the contained source:
```bash
unzip get_weather_export.zip -d /tmp/gw && \
  orchestrate tools import -k python -f /tmp/gw/get_weather.py -r /tmp/gw/requirements.txt
```
> ⚠ The zip entries carry a **leading `//` absolute path spec** (`//get_weather.py`), so
> `unzip` prints `warning: stripped absolute path spec from //get_weather.py` and **exits
> non-zero**. The files extract correctly — but a restore script running under `set -e` dies
> here. Use `unzip -oq … || true`, or check for the extracted files rather than the exit code.
> (live-verified 2.13.0)

**Round-trip fidelity (live-verified 2.13.0; 2.18.0 regression below):** agent YAML
round-trips cleanly — `collaborators:`, `skills:`, `tools:` all survive export → re-import.

> ⚠ **2.18.0: `agents export` aborts for any agent that has `skills:`**, with
> `Failed to find skill. No skill found with the id '<skill-name>'`. The CLI now stores
> skill *names* on import but still maps IDs→names on export. A backup script that loops
> `agents export` over every agent silently skips these. Keep agent YAML in Git as the source
> of truth until it's fixed. `tool_shortlisting` and `custom_agents_metadata` (native) do
> round-trip; the latter comes back with six reserved `null` keys the server adds.

Further caveats:
- **`display_name` is sticky.** Re-importing does not reset a display name set earlier
  (e.g. in the UI), so an agent whose YAML says `name: dr_house` can keep showing as
  "Dr. House (Diagnostics Lead)" in listings. Always reference agents by snake_case `name`.
- Agent skills export as a **directory** (`<out>/<skill-name>/SKILL.md`, plus a generated
  `WXO.yaml`, `scripts/` and `references/` on 2.18) and re-import with
  `skills import -d <that dir> --upsert` (`-f` would drop the scripts).

**Prove the restore, don't assume it.** A backup you have never restored is not a backup.
Delete one tool and one agent from the target env and bring them back from the exported
files alone before you call an environment reproducible.
Use `--safe` on `tools`/`agents`/`knowledge-bases` import to be prompted before
overwriting. *(Export/reimport behavior live-verified on IBM Cloud SaaS, ADK 2.12.0.)*

---

## 1a. Post-deploy verification gate (test before handover)

**Deployed ≠ verified.** After `orchestrate agents deploy`, do not declare the
agent "done"/"ready" until it is tested or the human declines. This is a decision
gate: Bob **asks first**, then runs a lightweight smoke test and reports evidence.

### Step 1 — confirm deployment
```bash
orchestrate agents list -v | grep -i <name>          # present in the active env?
orchestrate agents export -n <name> --kind native -o /tmp/<name>.yaml --agent-only  # round-trips?
```

### Step 2 — ask the human (gate)
> "`<agent>` is deployed to `<env>`. Want me to smoke-test it before handover? I'll
> run 1 single-turn + 1 multi-turn test against `<env>` — real prompts, may invoke
> its tools, so I'll keep to **read-only** prompts." — Yes / No

If **No**: report "deployed; not tested at your request" and stop. If **Yes**, continue.

### Step 3 — derive the tests from the agent's own spec
Read the deployed definition and mine it for realistic prompts:
- `starter_prompts` → ready-made example user prompts (best source for Test 1).
- `description` / `instructions` → the intended job and the tool it should call.
- `tools` → which tool a correct answer should invoke; note any `READ_WRITE` tools.

### Step 4 — run the two tests

Important: Always run one single-turn test and additionally one multi-turn test:
1. Single-turn test
2. Multi-turn test
2a. first user input (this is input is different from 1. Single-turn test)
2b. second user input (and thread_id from 2a)

There are two ways to run these tests dependent on whether the `watsonx-orchestrate-adk` MCP server is available.

#### 1. `watsonx-orchestrate-adk` MCP server is available

Run the MCP server `watsonx-orchestrate-adk` tool `chat_with_agent` for single-turn and multi-turn conversations.

#### 2. `watsonx-orchestrate-adk` MCP server is not available
```bash
# Turn 1 — single-turn. --live = the DEPLOYED version; omit it to test the draft
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n <agent> --live "<derived prompt>"
# → { "thread_id": "3f92692d-...", "final_message": "...", ... }

# Turn 2 — resume
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n <agent> --live --thread-id <thread-id> -r "<derived prompt>"
# → { "thread_id": "3f92692d-...", "final_message": "...", "reasoning_trace": {"steps": [...]}, ... }
```

The follow-up must NOT restate the entity (e.g. "and what about the second one?").

> ⚠ **Draft vs live (2.18.0):** without `--live`, the runs API executes the **draft**. After
> `agents deploy` the two are identical, so a default test passes. But any later
> `agents import` changes the draft only, and then a default test no longer proves what
> users of the deployed agent see. In the report, say which one you tested
> ("tested on live, v3"). SKILL.md §3.5 / §3.3d.

### Step 5 — judge by behavior, not exact text
LLM output is non-deterministic — assert on behavior:
- **No error** and a coherent, **on-topic** answer.
- The **expected tool was invoked** (visible in the `-r` reasoning / `-l` logs) —
  not answered from the model's own memory when a tool was required.
- **Multi-turn:** the follow-up answer **uses prior context** (the agent remembered
  the entity/state from turn 1).
- **Routing (multi-agent):** the expected collaborator was delegated to. On 2.18.0 the tool is
  `chat_with_collaborator_<slug of the collaborator's DISPLAY name>` (e.g.
  `…_dr_james_wilson_oncology` for `dr_wilson`), so match on the display-name slug or on the
  **`agent` field of the following tool call**, never on `…_<name>` equality (SKILL.md §3.3b).

> **Encode ambiguity as an accepted SET, not a single expected value.** Some questions have
> more than one correct route — a question that touches two specialties, or a broad framing
> question the orchestrator may legitimately answer itself. A suite that allows exactly one
> answer per question goes permanently red on those, and teams respond by loosening the whole
> suite until it detects nothing. Let each case declare a set of acceptable outcomes
> (including "no delegation" where that is valid) and keep everything else strict.

### Step 6 — safety (read-only by default)
- Default to **read-only prompts**. If the agent exposes `READ_WRITE`/`ADMIN` tools
  (creates tickets, sends mail, mutates data), do **not** craft prompts that trigger
  writes unless the human explicitly opts in.
- State the **target env** in the report — tokens/side-effects land there (mock/local
  vs SaaS/on-prem prod).

### Step 7 — emit `TEST_REPORT.md` and report status honestly
```markdown
# Agent Verification — <agent name> (<name>)
- Env: <local | nandaosi (SaaS) | on-prem>     Date: <YYYY-MM-DD>     LLM: <model>
- Tools available: <list>   (write-capable exercised? yes/no)

## Test 1 — single-turn
Prompt:   "<prompt>"
Result:   PASS | FAIL
Evidence: <response excerpt> · expected tool `<tool>` called: yes/no

## Test 2 — multi-turn (context retention)
Turn 1:   "<opening>"   →  <excerpt>
Turn 2:   "<follow-up>" →  <excerpt>     context retained: yes/no
Result:   PASS | FAIL

## Verdict: 2/2 passed — handover-ready   (or: 1/2 — <issue> — fix before handover)
```
Then say one of: **"deployed and tested (2/2 passed)"**, **"deployed; test N failed —
<reason>, recommend fixing before handover"**, or **"deployed; not tested at your
request."** For deeper, repeatable testing, escalate to the evaluations framework (§3).

---

## 2. Failure-mode table

| Symptom | Cause → Fix |
|---------|-------------|
| Agent import: required field error | Missing `spec_version`/`kind`/`name`/`description`. Add them. |
| Agent import: "cannot be used to create a native agent" | `kind` mismatch — set `kind: native`. |
| Import succeeds, agent ignores a tool | Weak tool `description`/docstring or instructions don't reference it. Improve docstring; name the tool in `instructions`. |
| Docstring/type-hint warnings on tool import | **Often a false positive in 2.12** — the warning fires on every Python tool yet descriptions still parse. Verify the parsed schema before "fixing". Real causes: missing type hints, or a blank line between `Args:` and `Returns:`. |
| "name cannot contain spaces" | Use snake_case names for tools/toolkits/agents. |
| `ModuleNotFoundError` at tool runtime | Add the dep to the tool's `requirements.txt`, re-import with `-r`. Do **not** add `ibm-watsonx-orchestrate`. |
| Cross-file import error | Tool files must be self-contained — inline helpers/models. |
| 401/403 from a tool/KB | Connection not configured/credentialed or wrong `app_id`. `orchestrate connections list`; re-run `set-credentials`. |
| Model not found / no default | `orchestrate models list`; set `llm:` to a listed id or `orchestrate models config default`. |
| Flow won't compile | Signature must be `def build_<name>(aflow: Flow) -> Flow:`; `prompt` nodes need `system_prompt`; `map_*` expressions single-line. |
| Doc flow can't get the uploaded file | Don't ask the agent to upload — the `docproc` node prompts the user. Agent just invokes the flow. |
| Works locally, absent in prod | Wrong active env. `orchestrate env list` → activate the right one → re-import. |
| **Orchestrator answers instead of delegating** | **Look in the orchestrator's own `instructions` first, not at the collaborators.** See the playbook below. |
| Delegation assertion fails though it clearly delegated | 2.13: the specialty was appended inconsistently (`…_dr_wilson_oncology`). 2.18: the name is a slug of the **display name** (`…_dr_james_wilson_oncology`). Match the display-name slug or the next step's `agent` field (SKILL.md §3.3b). |
| `agents list` output is unreadable | The rich table wraps to ~1 character per column on a normal terminal. Use `orchestrate agents list -v` and **parse the JSON**; never read the table. |
| Need server-side detail | `orchestrate server logs`. Reset corrupt local state with `orchestrate server reset`. |
| **Agent refuses a request it used to answer** | Check for a bound **control** before you touch the prompt: `orchestrate controls list --agent <name>`. A PII/guardrail control rewrites or blocks the payload at `agent_pre_invoke`, so the model — which never sees the original text — produces what looks exactly like its own safety refusal. Confirm from the trace: redacted values appear as `[REDACTED]` in the LLM input (SKILL.md §4a). |
| Control created but nothing changes | `--config` is not schema-validated, so a mistyped key leaves every detector on its default (**off**). Diff against `orchestrate controls get-type -n <artifact> -v`. Also check the binding actually landed: `controls get-details -n <name> -v` → `agent_ids`. |
| `controls import` → `already exists` / `No agent found with name '<Display Name>'` | Import is create-only (remove first), and `controls export` writes **display** names that import cannot resolve — rewrite `agent_names` to snake_case (SKILL.md §4a). |
| `agents import` → `At most 100 characters … Welcome message` | Older tenant (2.15.0 enforced it). 2.18.0 accepts longer messages. On an old tenant, shorten `welcome_message` and move the prose to `description`. |
| KB import → `Unsupported file type text/markdown` | Built-in ingestion rejects `.md`; rename to `.txt`. |
| Agent searches only one of several KBs | Each KB is a separate retrieval tool routed on its `description`. Make descriptions mutually exclusive and tell the agent in `instructions:` that a cross-cutting question must consult both. |
| `connections configure --name …` → `500 … column "name" of relation "application_connection_configs" does not exist` | The 2.15.0 custom API-key header is ahead of the SaaS backend schema. Drop `--name` (the update then succeeds) and set the header another way; re-test after a platform upgrade. |
| Voice import → `<vendor>_config must be specified for <vendor>` | `provider` must be `<vendor>_stt` / `<vendor>_tts` (e.g. `deepgram_stt`), not the bare vendor. The ADK types `provider` as a free string, so only the platform catches it. |
| Voice import raises a raw pydantic traceback | A required nested field is missing (e.g. Deepgram STT needs `api_url`). The CLI surfaces the `ValidationError` verbatim — read the `loc` path, it names the exact field. |
| Flow with a docproc node won't import | Two near-certain causes: `classes=`/`fields=` was given the **class** instead of an **instance**, or `flow_builder.types` was imported before `flow_builder.flows` (circular import). See agents-tools-schemas.md. |

### 2a. Playbook: the orchestrator answers instead of delegating

The most common multi-agent failure, and the cause is almost never the model. Work in this
order — the first step fixes it far more often than the last:

1. **Search the orchestrator's `instructions` for any permission to self-answer and delete
   it.** A single sentence like *"do not delegate a question you can answer with your own
   tools"* is enough to suppress routing entirely. Live-verified: removing one such sentence
   moved routing accuracy from **5/9 to 8/9** with no other change.
2. **State that delegation is the default, not the exception**, and make routing the
   orchestrator's stated primary job rather than step three of a list.
3. **Add mandatory rules naming the domains that must always route** — especially ones the
   orchestrator's *own* tools could plausibly cover ("a neurological finding goes to
   `dr_foreman` even though you could reason about it yourself; your tool frames the case, it
   does not replace the specialist") and ones that need no tool at all (non-clinical,
   administrative), where nothing otherwise forces a handoff.
4. **Only then tighten collaborator `description`s** so no two compete for the same trigger.
5. **Give the orchestrator as few tools as possible.** Every tool it owns is a reason not to
   route. An orchestrator with eight tools is a monolith wearing a supervisor's hat.

Verify by re-running a fixed prompt set and diffing routing accuracy before/after — one
instruction edit can swing it 30+ points, so measure rather than eyeball.

---

## 3. Built-in evaluation framework (AgentOps)

> **Full guide:** [agentops-evaluations.md](agentops-evaluations.md) — input formats
> (validate-native TSV, generate CSV, eval config), the end-to-end workflow, and how
> evaluations pair with observability traces.

**The engine is an extra — install it or the commands fail** with
`ModuleNotFoundError: No module named 'agentops'` (verified 2.12.0; the base install
ships only the CLI shims):
```bash
pip install "ibm-watsonx-orchestrate[agentops]"
```
Evaluations also need watsonx.ai creds in `.env` (LLM-as-judge + test synthesis).

| Command | Purpose |
|---------|---------|
| `orchestrate evaluations quick-eval` | Fast smoke evaluation of an agent |
| `orchestrate evaluations generate` | Generate test cases / datasets |
| `orchestrate evaluations evaluate` | Run a full evaluation against a dataset |
| `orchestrate evaluations analyze` | Analyze evaluation results |
| `orchestrate evaluations record` | Record interactions for later evaluation |
| `orchestrate evaluations validate-native` | Validate a native agent definition |
| `orchestrate evaluations validate-external` | Validate an external agent |

See the public `examples/evaluations/` directory at
https://github.com/IBM/ibm-watsonx-orchestrate-adk/tree/main/examples/evaluations
(evaluate, generate, analysis, red-teaming, rubric_evals, quick-eval,
with-file-upload, with-context-variable, external/native validation) for runnable
patterns. Run `orchestrate evaluations <cmd> --help` for current flags.

---

## 4. Observability / tracing

- Start the local server with IBM telemetry: `orchestrate server start -i`
- Inspect traces via `orchestrate observability traces` (subcommands: `search`, `export`)
  to see the agent's tool-call decisions, latencies, and errors — the best way to
  understand *why* an agent chose (or skipped) a tool.
- **2.13.0 (live-verified):** `search` takes a relative window and user/session filters;
  `export` returns **observations** (not spans):
  ```bash
  orchestrate observability traces search --last 30m            # relative window (30m/3h/10d)
  orchestrate observability traces search --last 3h --user-id <u> --session-id <s>
  orchestrate observability traces export --trace-id <trace_id> # observations JSON; -o to save
  ```
  `search --last` **now returns results on SaaS** (in 2.12.0 it returned 0 traces even when
  they existed — that regression is fixed). The old `--agent-name`/`--agent-id`/
  `--service-name`/`--min-spans`/`--max-spans` filters are deprecated. The `trace_id` is in
  every `/v1/orchestrate/runs` response; the `export` payload has
  `{observations, total_count, exported_at, format, trace_id}`.
- **AgentOps v3 API** — the rich surface, and the only one with per-span `latency`, the span
  tree (`parentObservationId`), error `level`, and trace-level `scores[]`:
  ```bash
  curl -H "Authorization: Bearer $TOKEN" \
    "<instance-url>/v1/agentops-v3/traces/<trace_id>"     # 200; old /v1/agentops/… → 404
  ```
  ⚠ **Fields are camelCase** here, unlike everywhere else in wxO — `startTime`, `totalCost`,
  `parentObservationId`. Snake_case guesses silently return `None`.

**Three facts that change how you build on this** (live-verified 2.13.0, item 1 updated
2.18.0. Full detail in [agentops-evaluations.md](agentops-evaluations.md) §4–§7):

1. **Run-level tokens are on the runs API since 2.18.0** (`run.usage.token_usage`, incl.
   `cached_tokens`; it was `null` on 2.13.0). **Per-call** tokens are only in the trace, at
   `observation.usage` on `GENERATION` observations.
2. **`trace.totalCost` is `0`.** Tokens are native and exact; **pricing is not**. Multiply by
   your own rate card.
3. **Error rate, tail latency, tool-call success and every dashboard are yours to derive.**
   Nothing ships. Exclude the sub-second infrastructure traces (blank agent name) from any
   statistic, and remember `traces search` still shows an `Agent Name` column even though
   `--agent-name` is a deprecated no-op — filter client-side.

### Logs in Developer Edition

When using the local Developer Edition (`orchestrate env list` local is active), 
logs can be accessed:

```bash
export LIMA_INSTANCE=ibm-watsonx-orchestrate
lima docker logs -f dev-edition-tools-runtime-1
lima docker logs dev-edition-wxo-tempus-runtime-1"
```

---

## 5. Programmatic flow testing

For flows, test the compiled spec directly before importing:
```python
import asyncio
from pathlib import Path
from tools.weather_flow import build_weather_flow

async def main():
    fdef = await build_weather_flow().compile_deploy()
    fdef.dump_spec(f"{Path(__file__).parent}/generated/weather_flow.json")
    await fdef.invoke({"city": "Paris"}, debug=True)   # debug=True prints node I/O

if __name__ == "__main__":
    asyncio.run(main())
```
`debug=True` surfaces each node's input/output so you can pinpoint a bad
`map_input`/`map_output` expression.

---

## 6. Pre-publish checklist

- [ ] All tools have `@tool` + valid Google-style docstrings + type hints.
- [ ] All flows use `build_<name>(aflow: Flow) -> Flow`, one per file.
- [ ] Agent YAML has `spec_version`, `kind: native`, `name`, `description`,
      `instructions`, `llm`, `style`, `tools`.
- [ ] Every referenced tool/KB/collaborator/connection/model is imported first.
- [ ] No secrets in YAML or code; credentials via `connections set-credentials`.
- [ ] `starter_prompts` + `welcome_content` set for good UX.
- [ ] Post-deploy verification gate (§1a) run: 1 single-turn + 1 multi-turn pass, `TEST_REPORT.md` produced — or the human explicitly declined testing.
- [ ] Definitions exported to Git; `import-all.sh` reproduces the build cleanly.
- [ ] Verified in the **production** env after `env activate`; agent `deploy`d.
