---
name: watsonx-orchestrate
description: >-
  Build, import, test, debug, and publish IBM watsonx Orchestrate agents, tools,
  flows, toolkits (MCP), connections, models, and knowledge bases using the
  watsonx Orchestrate Agent Development Kit (ADK) and the `orchestrate` CLI.
  Use this whenever the user mentions watsonx Orchestrate, wxO, the orchestrate
  CLI, the ADK, `ibm-watsonx-orchestrate`, native/external/assistant agents,
  agent YAML, the `@tool` / `@flow` decorators, the Developer Edition, or wants
  to create / import / chat-test / deploy a wxO agent or tool — including agent
  versions/releases and rollback, tool shortlisting, user activity flows, agent
  skills with scripts, and document-processing flows. Also covers
  embedding/consuming a deployed agent from a custom application via the wxO
  runtime REST API (`/chat/completions`, `/orchestrate/runs`, streaming) — as
  opposed to the drop-in embedded web-chat widget.
  Also covers **operating** a deployed agent: multi-agent routing problems (an
  orchestrator that answers instead of delegating, `chat_with_collaborator_*`),
  observability traces and the AgentOps v3 trace API, diagnosing latency from a
  trace, token counting and cost estimation, evaluations / LLM-as-judge scores,
  and building the error-rate / tail-latency / tool-call-success metrics that wxO
  does not ship. Use it for questions like "why is my wxO agent slow", "what does
  this agent cost", "why didn't it call the right agent", or "where are the wxO
  dashboards".
metadata:
  enabled: true
---

# IBM watsonx Orchestrate (wxO) — Build · Test · Debug · Publish

Authoritative, end-to-end guide for delivering production agents on IBM watsonx
Orchestrate with the Agent Development Kit (ADK). It is grounded in the real ADK
source and CLI (`ibm-watsonx-orchestrate`), not guesswork.

> **Golden rule:** the ADK changes fast. The CLI specifics here were
> **live-verified against `ibm-watsonx-orchestrate` 2.18.0** (IBM Cloud SaaS,
> us-south, 2026-10-01). When a command, flag, or YAML field is uncertain — or
> you're on a different version —
> **verify against the live tool** with `orchestrate <group> --help` and
> `orchestrate <group> <cmd> --help` before running it. Treat third-party blog
> syntax as approximate; trust `--help` and this skill's references. Check your
> version with `orchestrate --version` / `pip show ibm-watsonx-orchestrate`.
> Upgrade with `pip install -U ibm-watsonx-orchestrate` (needs Python ≥3.11, <3.15).

> **What's new in 2.16 → 2.18** (live-verified on SaaS unless marked — evidence in
> `test/house_hospital/results/TEST_REPORT.md`):
> - **Tool shortlisting** (2.18) — `tool_shortlisting: {enabled, max_tools}` on a native agent.
>   **Only acts on the v2 chat-completions API**: −59 % input tokens there, *zero* effect via
>   `/orchestrate/runs` or v1 (§3.3a).
> - **User activity nodes** (2.18) — `userflow.activity()` + one widget, `label` +
>   `agent_message` with `{flow.input.*}` (§3.2a).
> - Doc processing: text extractor **`output_content_types`** (`text|markdown|html`, `[]` = skip)
>   (2.18), classifier **`page_range`** (2.18), **`error_handler_config`** on every node (2.16);
>   classifier/field extractor are GA (2.16) (agents-tools ref).
> - **Agent skills with scripts** (2.18 hello-world) — `skills import --dir` uploads
>   `scripts/` + `references/`; the runtime calls a function named **`run`** (§3.3c).
> - **Gemma 4 31B** `bedrock-mantle/google.gemma-4-31b` (2.18) — works even when `models list`
>   does not show it (§4).
> - **Agent versioning** (2.17) — release / switch / undeploy / delete versions. **REST only, no
>   CLI verbs** (§3.3d).
> - **External agents as collaborators** (2.17), **`custom_agents_metadata`** (2.17, native only
>   in practice), **Azure auth modes** (2.17, on `azure-ai`), multi-turn widgets, Slack SSO.
> - **AgentNode `thread_control_policy`** (2.16), **JWT Bearer connections** (2.16, §5),
>   hidden **`env add --iam-url`** (2.16), `k8s` (EKS) env type (2.16).
>
> ⚠ **2.18.0 behaviour changes that break older advice** (all live-verified):
> 1. **Tests hit the DRAFT by default.** `/orchestrate/runs` and chat completions run the draft
>    unless you pass the live `environment_id` → use `wxo-chat.sh --live` after deploy (§3.5).
> 2. **Collaborator tool names are a slug of the `display_name`**, not the `name`:
>    `dr_wilson` → `chat_with_collaborator_dr_james_wilson_oncology` (§3.3b).
> 3. **`agents export` fails for any agent with `skills:`** (the CLI stores raw names on import
>    but expects UUIDs on export). Runtime is fine (§3.3c).
> 4. **`run.usage` is now populated** and the **`welcome_message` 100-char cap is gone** — both
>    reverse what 2.15 said.

> **2.14 → 2.15 recap** (live-verified in `test/house_clinic/`):
> **`orchestrate controls`** binds policy artifacts (PII filter, guardrails, secrets
> detector, rate limiter, …) to agents/tools/models at execution hooks — **the flagship
> 2.15 feature, and it really fires at runtime** (§4a);
> an agent may now reference **multiple knowledge bases**, and each one shows up as its own
> retrieval tool (§3.3);
> `welcome_content` gains **`is_user_barge_in_disabled`** (§3.3);
> voice configs gain **Google TTS**, Deepgram **`normalize_volume`**, and finer idle control
> (**`use_llm_generated_idle_message`**, **`repeat_previous_message`**,
> **`long_running_task_seconds`**) (§4b);
> `connections configure` accepts **`--name`** to override the `api_key` header (§5);
> every document-processing node accepts **`language=`**, and the classifier is capped at
> **30 classes** (§3.2/agents-tools ref);
> flows gain **`on_flow_abort`** / **`on_flow_delete`** callbacks;
> external agents can now **export traces** to the Analytics dashboard via OpenTelemetry or
> the Observability SDK (§6b);
> new model provider **`redhat-ai`** and external-agent provider **`msftstudio`** (§4).
>
> ⚠ **Two release-note names still do NOT match the enums:** the provider documented as
> `red_hat_ai` is **`redhat-ai`**, and the external-agent provider documented as
> `microsoft_copilot_studio` is **`msftstudio`**. Use the enum values. (The third 2.15
> mismatch, the 100-character welcome cap, is fixed by 2.18.0.)

---

**Critical**
- Always run the script `source ./.bob/skills/watsonx-orchestrate/references/setup-venv.sh` 
  before doing anything else and before running the `orchestrate` CLI!
- After code generation always deploy/import and runs tests (see 3.5 Test)

---

## 1. Mental model — what you are building

watsonx Orchestrate runs **agents** that route user requests to **tools**,
**collaborator agents**, and **knowledge bases**, powered by an **LLM**.

| Resource | What it is | Defined as |
|----------|------------|------------|
| **Agent** | An LLM-driven assistant. Kinds: `native` (built here), `external` (A2A / external chat), `assistant` (watsonx Assistant) | YAML (`kind: native`) or Python `Agent` |
| **Tool** | A capability the agent can call | Python `@tool`, OpenAPI spec, Flow, or Langflow |
| **Flow** | A multi-step orchestrated workflow exposed as a tool | Python `@flow` (`build_<name>(aflow: Flow) -> Flow`) |
| **Toolkit** | A bundle of tools from an **MCP server** | `orchestrate toolkits add -k mcp …` |
| **Skill** *(2.13.0)* | A portable, version-controlled package of specialized knowledge/workflow attached to agents | `SKILL.md` (+ optional `WXO.yaml`) via `orchestrate skills import` |
| **Connection** | Stored credentials/config for an external service | YAML (`kind: connection`) + `connections` CLI |
| **Model** | An LLM made available to agents (e.g. watsonx.ai, Groq) | YAML (`kind: model`) via the AI Gateway |
| **Knowledge base** | Documents for RAG/grounding | YAML (`kind: knowledge_base`). An agent may reference **several** (2.15.0) |
| **Control** *(2.15.0)* | A policy artifact (PII filter, guardrails, rate limiter…) bound to agents/tools/models at an execution hook | `orchestrate controls create` or YAML (`kind: control`) |
| **Agent version** *(2.17.0)* | An immutable release of an agent; each environment (`draft`/`live`) points at one | `orchestrate agents deploy` (creates one) + the REST releases API (§3.3d) |

The two surfaces you work through:

- **The `orchestrate` CLI** — manages every resource in the *active environment*.
- **The Developer Edition** — a full local wxO that runs on Docker (`orchestrate server start`) so you can iterate before touching production.

---

## 2. Prerequisites

Network access to your wxO instance (SaaS or on-prem) — or Docker for the 
local Developer Edition is required. 
Important: Always run the script
`source ./.bob/skills/watsonx-orchestrate/references/setup-venv.sh` before 
doing anything else!
The setup-venv.sh creates a virtual environment with Python and the `orchestrate` CLI.

Everything below works against **whatever environment is active**. The same
agent/tool artifacts deploy unchanged to local, SaaS, or on-prem — only the
environment you activate and the connection credentials differ.

---

## 2a. Connect to your environment (do this first)

`orchestrate` runs every command against the **active environment**. Pick one of
three targets; **SaaS and on-prem are the production paths**, local is optional.

### SaaS (IBM Cloud) — verified working flow
Use the **API service URL** (the one containing `/instances/<id>`), not the
console URL, and your **IBM Cloud API key**.

```bash
orchestrate env add -n my-saas \
  -u https://api.<region>.watson-orchestrate.cloud.ibm.com/instances/<INSTANCE_ID>
orchestrate env activate my-saas --api-key "$IBM_CLOUD_API_KEY"
orchestrate agents list          # confirm you're connected
```
Auth type is auto-inferred (typically `ibm_iam` for IBM Cloud SaaS). If inference
is wrong, set it explicitly on `env add` with `--type [ibm_iam|mcsp|mcsp_v1|mcsp_v2|cpd|k8s]`
(`k8s` = EKS, 2.16.0).

**HIPAA clusters / MCSP V2 (2.16.0):** pass the IAM token URL on **`env add`**:
`orchestrate env add -n hipaa -u <url> --type mcsp_v2 --iam-url <iam-token-url>`.
⚠ Live-checked 2.18.0: the flag is **hidden** from `env add --help` (it still works) and does
**not exist on `env activate`**, although the release note lists both commands.

### On-prem (Cloud Pak for Data / CPD)
```bash
orchestrate env add -n my-onprem -u https://<cpd-host>/orchestrate --type cpd \
  [--insecure | --verify /path/to/ca.crt]      # for self-signed / private CAs
# Authenticate with an API key OR username+password (not both):
orchestrate env activate my-onprem --api-key "$CPD_API_KEY"
orchestrate env activate my-onprem -u "$CPD_USER" -p "$CPD_PASSWORD"
```

### Local Developer Edition (optional — offline iteration)
A full local wxO on Docker (Rancher/Colima): 16 GB RAM / 8 cores / 25 GB disk
(≥19 GB if Document Processing `-d`). Needs an entitlement key in `.env`.
```bash
orchestrate server start -e .env --accept-terms-and-conditions
orchestrate env activate local
orchestrate chat start            # local-only chat UI
```

⚠ **Excel input to the Document Extractor is off by default in Developer Edition 2.15.0.**
The node supports `.xlsx`, but you must opt in — add to `.env` and restart the server:
```bash
GLOBAL_WORKER_DOCLING_PIPELINE=true
```
Known limitation while that is on: **only one document at a time**. Uploading or ingesting
several concurrently — via Document Processing tools *or* knowledge ingestion — can fail.
Plan demos accordingly; IBM say this is temporary.

### Environment hygiene
```bash
orchestrate env list                 # the active one is starred; that's where imports land
orchestrate env activate <name>      # switch targets
orchestrate env remove --name <name>
```
> **Always confirm the active env before importing** — the #1 cause of confusion.
> Keep secrets in a gitignored `.env` and pass via `"$VAR"` so keys stay out of
> shell history. Treat the IBM Cloud API key like a password; rotate if exposed.

See **[references/cli-reference.md](references/cli-reference.md)** for the full
command catalog. Need example projects? The public ADK repo's `examples/`
directory and the official docs are the canonical source — see §10.

---

## 3. The canonical lifecycle

Follow this order. Dependencies must exist *before* the thing that references them.

```
setup `orchestrate` CLI → scaffold project → write tools (+connections/models/KB/skills) 
   → write agent YAML → run `import-all.sh` (1. import connections → 
   2. import models → 3. import KB → 4. import tools/toolkits → 5. import skills → 
   6. import agent) → run test (see 3.5 Test) → debug → re-import → deploy to production
```

### 3.1 Scaffold

```
my_agent/
├── README.md
├── agents/            my_agent.yaml
├── tools/             *.py  (one @flow per file; @tool can be grouped)
├── connections/       *.yaml (kind: connection)
├── knowledge_base/    *.yaml + source docs
├── skills/            <skill-name>/SKILL.md (+ optional WXO.yaml) — 2.13.0 agent skills
├── models/            *.yaml (kind: model) — only if adding a custom model
├── import-all.sh      orchestrate ... import commands, dependency-ordered
├── delete-all.sh      orchestrate ... delete commands, counter-part to import-all.sh
└── .env               secrets (gitignored)
```

### 3.2 Write a Python tool

```python
from ibm_watsonx_orchestrate.agent_builder.tools import tool, ToolPermission
from pydantic import BaseModel

class WeatherInformation(BaseModel):
    city: str
    temp_c: float

@tool(permission=ToolPermission.READ_ONLY)   # or READ_WRITE
def get_weather(city: str) -> WeatherInformation:
    """
    Get the current weather for a city.

    Args:
        city (str): Name of the city to look up.
    Returns:
        WeatherInformation: Temperature in celsius for specific city.
    """
    return WeatherInformation(
        city=city,
        temp_c=21.1)
```

Decorator rules and docstring grammar are strict — getting them wrong is the
most common import failure. See §5 and
**[references/agents-tools-schemas.md](references/agents-tools-schemas.md)**.

> ⚠ **You will see this on EVERY Python tool import — it is a false positive. Do not
> "fix" it.**
> ```
> [WARNING] - Unable to properly parse parameter descriptions due to missing or incorrect
>             type hints. This may result in degraded agent performance.
> ```
> It fires on correctly-annotated tools and the descriptions still parse fine (live-verified
> 2.12.0 and 2.13.0). Chasing it wastes a lot of time and often makes the tool worse. Only
> act if the **parsed schema is actually missing descriptions**; the real causes are a
> genuinely missing type hint, or a blank line between the `Args:` and `Returns:` blocks.

### 3.2a Flows: 2.16 → 2.18 node features (live-verified 2.18.0)

Full signatures are in [references/agents-tools-schemas.md](references/agents-tools-schemas.md).
These are the parts that changed:

**User activity nodes (2.18).** A single-widget user interaction. Create it inside a
`userflow`, then attach **exactly one** widget (a second widget raises `ValueError`):
```python
intake = aflow.userflow(display_name="Admission", label="Admitting {flow.input.patient_name}")
consent = intake.activity(name="consent", display_name="Consent")
consent.boolean_input_field(name="consent_given", label="Consent to treatment",
    agent_message="Does {flow.input.patient_name} consent to admission?",
    true_label="Yes", false_label="No", required=True)
done = intake.activity(name="confirmation")
done.message_output_field(name="msg", text="{flow.input.patient_name} is queued.")  # use text=, label is ignored
intake.edge(START, consent); intake.edge(consent, done); intake.edge(done, END)
aflow.sequence(START, intake, END)
```
Widgets: `text_input_field`, `boolean_input_field`, `number_input_field`, `date_input_field`,
`datetime_input_field`, `message_output_field`, plus `file_upload_field` (in the 2.18 source,
not the release note). Choice/list widgets need `form()`. At runtime each activity arrives as a
`response_type: "multiturn_form"` message on the thread. `label` becomes the field title, and
`agent_message` becomes the prompt, with `{flow.input.*}` substituted. A **plain-text reply
on the thread answers it**, so the runs API can drive the whole flow. The thread is blocked
until the flow ends. ⚠ `activity_info.activity_title` shows the userflow's **`display_name`**,
not its `label`.

**Agent nodes with `thread_control_policy` (2.16):**
`aflow.agent(name=…, agent="dr_wilson", …, thread_control_policy="CREATE_ALWAYS")`. The
values are `"REUSE_AND_CORRELATE"` (default: reuse the correlated thread) and
`"CREATE_ALWAYS"` (an isolated thread on every invocation). Omitting it logs a warning.
Import the agents **before** the flow that calls them.

**Document processing (2.16 → 2.18):**
- `aflow.docproc(..., output_content_types=[OutputContentType.markdown, OutputContentType.html])`
  (2.18). The response then carries `.markdown` / `.html` / `.text`. `None` defaults to
  `["text"]`; **`[]` skips text extraction entirely** (KVP-only runs).
- `aflow.docclassifier(..., page_range=PageRange(start=1, end=2))` (2.18) classifies from those
  pages only. Classifier and field extractor are **GA** as of 2.16.
- Every doc node accepts `error_handler_config=NodeErrorHandlerConfig(max_retries=2,
  retry_interval=5, on_error="show_message"|"branch", error_message="…")` (2.16).
- These nodes need an uploaded document to run, so they could only be verified at the spec
  level here: export the flow (`tools export -n <flow> -o x.zip`) and grep for the keys.

### 3.3 Write the agent YAML

```yaml
spec_version: v1
kind: native
name: weather_agent
description: Returns weather information for a location.
instructions: >
  You are a helpful weather assistant. When the user asks about weather,
  call the get_weather tool with the city name and present the result clearly.
llm: watsonx/meta-llama/llama-3-3-70b-instruct   # example only — pick one that EXISTS in `orchestrate models list` (§4)
style: react_core                                 # 2.13.0 DEFAULT; `default`, `react`, `planner` are DEPRECATED (omit to take the default)
tools:
  - get_weather
starter_prompts:
  prompts:
    - id: default0
      title: Check weather
      subtitle: Ask about any city        # optional — shown below the title
      prompt: What's the weather in Boston?
welcome_content:
  welcome_message: Welcome to the Weather Agent      # 100-char cap lifted by 2.18.0 (below)
  description: Ask me about the weather in any city.
  is_user_barge_in_disabled: false   # 2.15.0 — true = the user cannot interrupt the
                                     #   agent's spoken opening message (voice agents)
knowledge_base:                      # 2.15.0 — an agent may reference MORE THAN ONE
  - city_climate_notes
  - regional_weather_policy
# ⚠ starter_prompts: do NOT add `is_default_prompts:` or `state:` — they are
#   silently ignored by the platform and cause prompts not to render in the UI.
#   Valid fields per prompt: id, title, subtitle, prompt. (live-verified 2.12.0)
```

**`welcome_message` length:** on **2.18.0 SaaS a 164-character message was accepted and
stored intact**, so the long-standing 100-character cap is gone. On 2.15.0 the API still
rejected anything over 100 with
`At most 100 characters are allowed for Welcome message` (422). If you target an older
tenant and hit that error, move the prose to `description:`.

**`starter_prompts`:** IBM's own 2.18 examples still set `is_default_prompts:` and `state:`;
the platform ignores them. Valid per-prompt fields remain `id` (required, 2.17), `title`,
`subtitle`, `prompt`.

#### Multiple knowledge bases (2.15.0) — how routing actually works

Listing several KBs is not "one bigger corpus". **Each knowledge base is exposed to the
agent as its own retrieval tool, named after the KB**, and the router picks between them
the same way it picks any tool — **from the KB's `description`**. Live-verified: a single
question spanning two KBs produced two separate tool calls in `step_history`
(`["ppth_formulary", "ppth_policy"]`) and two matching observations in the trace.

So, when splitting a corpus across KBs:
- Write each KB `description` as a **routing trigger** ("drugs, dosing, what is
  restricted"), not a summary. Make them mutually exclusive.
- Say in `instructions:` which question goes to which KB, and that a question spanning
  both must consult both — otherwise the agent will often stop after the first hit.
- Splitting is worth it when the sub-corpora answer *different kinds of question*. One
  homogeneous corpus should stay one KB; two KBs competing for the same trigger is a coin flip.

⚠ **Built-in KB ingestion rejects `.md`.** `Unsupported file type text/markdown` —
despite agent *skills* being authored as `SKILL.md`. Supported: PDF/DOCX/PPTX/XLSX/CSV/
HTML/**TXT**. Rename `.md` → `.txt` (live-verified 2.15.0).

Required fields: `spec_version`, `kind`, `name`, `description`. Strongly
recommended: `instructions`, `llm`, `style`, `tools`, plus `starter_prompts` /
`welcome_content` for UX. Full field reference (collaborators, knowledge_base,
guidelines, structured_output, chat_with_docs, voice, channels) is in
**[references/agents-tools-schemas.md](references/agents-tools-schemas.md)**.

### 3.3a Production-grade agent fields (ADK 2.11+, verify before relying on)

For long-running or recurring agents, add these optional blocks (sourced from the
ADK docs — confirm with `orchestrate agents create --help` / the schema reference):

```yaml
# Conversation compaction — prevents context overflow in long chats
compaction_settings:
  context_compaction_enabled: true
  context_compaction_threshold: 20000   # tokens that trigger Level-1 compaction
  compaction_sliding_window: 10         # most-recent messages kept verbatim
  large_message_threshold: 50000        # token size that marks a "large" message
  large_message_chunk_size: 30000
  large_message_target_summary: 10000
  large_message_detect_structured: true

# Per-agent LLM decoding params (greedy/temperature, limits, response format, …)
llm_config:
  temperature: 0
  max_tokens: 2048
  # top_p / top_k / seed / response_format / reasoning_effort / provider extensions

is_schedulable: true     # enables recurring runs; internal scheduling tools auto-appear
# restrictions: …        # access restrictions (see schema reference)

# Tool shortlisting (2.18.0) — retrieve the most relevant tools before planning
tool_shortlisting:
  enabled: true          # omit → the style's default
  max_tools: 5           # > 0; omit → the style's default

# Free-form labels for downstream routing / feature flags (2.17.0)
custom_agents_metadata:
  team: diagnostics
  tier: gold
```

⚠ **Tool shortlisting only works through the v2 chat-completions API** (live-verified 2.18.0,
same 12-tool agent and prompt, input tokens per LLM call):

| Endpoint | shortlisting OFF | shortlisting ON |
|---|---|---|
| `POST /v2/orchestrate/{agent_id}/chat/completions` | 708 | **288 (−59 %)** |
| `POST /v1/orchestrate/{agent_id}/chat/completions` | 672 | 672 |
| `POST /v1/orchestrate/runs` (what `wxo-chat.sh` uses) | 672 | 672 |

The field is stored and round-trips, but on v1/runs it is silently inert. Shortlisting
helps agents with **many** tools whose end users come in through v2. Don't enable it to "fix"
routing you're testing through the runs API; you'd be measuring nothing. The trace's
`GENERATION.input` omits the tool schemas, so **compare `usage.input` tokens** to check it.

⚠ **`custom_agents_metadata` (live-verified 2.18.0):**
- **Native agents:** round-trips, but the server **injects six reserved keys set to `null`**
  (`language`, `framework`, `tool_count`, `tool_names`, `tool_parameters`,
  `connection_requirements`; they describe *custom* agents). Don't use those names, and
  ignore them when diffing an export.
- **External agents:** **dropped server-side**. YAML, `agents create --custom-agents-metadata`,
  and a direct `PATCH` all return success and store nothing. Keep external-agent labels in
  `tags:` instead.
- CLI: `orchestrate agents create … --custom-agents-metadata '{"key":"value"}'` (JSON dict).

### 3.3b Orchestrator / multi-agent (collaborators) — live-verified 2.13.0

A native agent becomes an **orchestrator (supervisor)** that uses *other agents as
agents* by listing them under `collaborators:`. wxO's multi-agent pattern:

```yaml
name: dr_house
style: react_core               # 2.13.0 default; supports collaborators (experimental_customer_care does NOT)
tools:                          # the orchestrator can still call its own tools
  - differential_diagnosis
collaborators:                  # other agents, by snake_case name — imported FIRST
  - dr_wilson                   # oncology specialist agent
  - dr_cuddy                    # administration agent
  - dr_foreman                  # neurology agent
skills:                         # 2.13.0 — attach agent skills by name (kebab-case!) — see §3.3c
  - diagnostics-protocol
```

How it works (verified end-to-end):
- **Import/deploy collaborators *before* the orchestrator** (they're dependencies).
  Deploy all of them on SaaS so runtime delegation can reach them.
- At runtime wxO auto-generates a **`chat_with_collaborator_…`** tool on the
  orchestrator. The router picks a collaborator the same way it picks a tool —
  **from the collaborator's `description`.** So collaborator descriptions must be
  **distinct and routing-friendly** (lead with the specialty/trigger). The orchestrator
  then frames the collaborator's reply in its own voice.
- Delegation is visible in the run `step_history`/reasoning trace as a `tool_calls` step
  named `chat_with_collaborator_…`.

  > ⚠ **On 2.18.0 the tool name is a slug of the collaborator's `display_name`, not its
  > `name`.** Live-verified, all five specialists:
  > `dr_wilson` (display "Dr. James Wilson (Oncology)") →
  > `chat_with_collaborator_dr_james_wilson_oncology`;
  > `dr_chase` ("Dr. Robert Chase (Cardiology and Surgery)") →
  > `chat_with_collaborator_dr_robert_chase_cardiology_and_surgery`.
  > On 2.13.0 it was `chat_with_collaborator_<name>` plus an inconsistent specialty suffix.
  > **Neither equality nor a `…_<name>` prefix check is reliable across versions.** Assert
  > on the step's **`agent`** field instead (the collaborator's display name appears as the
  > `agent` of the *next* tool call), or build the expected slug from the display name:
  > ```python
  > import re
  > slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
  > hit = name.startswith("chat_with_collaborator_") and (
  >     slug(display_name) in name or agent_name in name)
  > ```
- **External agents can be collaborators** (2.17.0, import-verified 2.18.0): list a
  `kind: external` agent's name under `collaborators:` like any native one. It must be
  imported first; the router still picks it from its `description`.
- Collaborators are themselves full agents (own tools/KB/collaborators) — **nesting
  works**: live-verified a 3-level chain House → Foreman → Chase where the mid-tier agent
  (Foreman) used its *own* tool AND sub-delegated. The whole nested chain (sub-agent tool
  calls + sub-delegations) is flattened into the top-level run's `step_history`.
- An agent **cannot list itself** as a collaborator (circular reference rejected).

> **Routing tip:** the router picks a collaborator from its **`description`**, so write that
> field as a *routing trigger* — lead with the specialty and the concrete findings/keywords
> that should land there — not as a personality blurb. Make the descriptions mutually
> exclusive; two agents competing for the same trigger is a coin flip.
>
> **If the orchestrator answers instead of delegating, look at its OWN `instructions`
> first.** A single permissive sentence (*"do not delegate a question you can answer with
> your own tools"*) suppresses routing entirely — live-verified, removing one such sentence
> moved routing accuracy from **5/9 to 8/9** with no other change. Make delegation the
> stated default, add mandatory rules for domains the orchestrator's own tools could
> plausibly cover, and give the orchestrator **as few tools as possible** — every tool it
> owns is a reason not to route. Full playbook:
> [references/testing-debugging.md](references/testing-debugging.md) §2a.

⚠ **Scheduling caveats (live-verified 2.12.0):**
- `is_schedulable: true` set in YAML **did not persist** — import succeeded but the
  round-trip export came back `is_schedulable: false`. Scheduling needs to be **enabled
  at the tenant level first** (per the platform "enable scheduling" step); the YAML flag
  alone silently resets. Verify with an export round-trip; don't assume it stuck.
- Once enabled, internal scheduling tools are **visible and deletable via the ADK CLI**
  (known issue) — don't remove them by hand.
- Schedules themselves are created conversationally in chat, not in YAML.

### 3.3c Agent skills (NEW in 2.13.0) — live-verified 2.13.0

**Agent skills** are portable, version-controlled packages that equip agents with
specialized knowledge and workflows. A skill is a **`SKILL.md`** file with YAML
frontmatter, optionally accompanied by a sibling **`WXO.yaml`** (sent automatically on
import) plus scripts/reference docs.

#### Skill vs. Knowledge base vs. Tool — which to reach for

These three attach to an agent but answer different questions. Picking wrong is the most
common design mistake now that skills exist. Rule of thumb by what you're adding:

| You're giving the agent… | Use | Why |
|--------------------------|-----|-----|
| **Procedural know-how** — *how to do the job*: a workflow, playbook, decision rules, conventions, when-to-escalate logic (prose/markdown the model reads) | **Skill** (`SKILL.md`) | Portable, versioned instructions. Extends `instructions:` with reusable, shareable procedure — no execution, no corpus. |
| **A body of documents** to look up *facts* from — manuals, policies, PDFs, tickets — answered by retrieval/citation | **Knowledge base** | RAG over an ingested corpus. You pre-ingest documents; the agent grounds answers and cites them. |
| **An action** — call an API, run a computation, read/write a system, return structured data | **Tool** (`@tool` / OpenAPI / flow / MCP) | Executable capability with typed I/O and permissions. The only one that *does* something. |

Decision shortcuts:
- "The agent keeps doing the steps in the wrong order / skipping a policy" → **skill** (encode the procedure), not a tool.
- "The agent needs to *know facts* from our docs" → **knowledge base**, not a skill (don't paste a document corpus into `SKILL.md`).
- "The agent must *fetch or change* something" → **tool**, always.
- They compose: a skill can *describe when to call* a tool or search a KB; it doesn't replace either. The Dr. House team uses all three — `diagnostics-protocol` (skill: the differential workflow + escalation rules), `differential_diagnosis`/`lab_reference` (tools: the actions), and a KB would be the place for, say, an ingested formulary.
- Skills vs. `instructions:` — put *stable, reusable, shareable* procedure in a skill (versioned, attachable to many agents); keep *this agent's* voice and one-off routing in `instructions:`.

```markdown
---
name: diagnostics-protocol        # ⚠ kebab-case ONLY (agentskills.io spec) — see below
description: >-
  When and how to use this skill (used for relevance). Structured differential-diagnosis
  protocol for the diagnostics team.
version: 1.0.0
---

# Diagnostics Protocol
...the procedure the agent should follow...
```

Lifecycle (group is **`skills`**):
```bash
orchestrate skills import -d skills/diagnostics-protocol --upsert   # dir import: SKILL.md + scripts/ + references/
orchestrate skills import -f skills/diagnostics_protocol/SKILL.md --upsert   # SKILL.md (+ WXO.yaml) only
orchestrate skills list                     # Name · Description · Mode · Tools · Scripts · ID
orchestrate skills get -n diagnostics-protocol
orchestrate skills upload-script    …       # attach an executable script to a skill
orchestrate skills upload-reference …       # attach a reference doc
orchestrate skills export -n diagnostics-protocol -o <dir|zip>
orchestrate skills remove -n diagnostics-protocol
```

Attach to a native agent by name via the new **`skills:`** field (round-trips on export):
```yaml
skills:
  - diagnostics-protocol
```

#### Skills with scripts and references (2.18.0 hello-world pattern), live-verified 2.18.0

```
skills/ppth-diagnostics-protocol/
├── SKILL.md            # frontmatter name/description(/version) + the procedure
├── scripts/score.py    # executable: called through the execute_skill_script tool
└── references/criteria.md   # reference doc, uploaded alongside
```
`skills import -d <dir>` uploads all three in one call and reports
`(1 script(s), 1 reference(s))`. At runtime the agent calls `load_skill`, then
**`execute_skill_script`** with `{"script_path": "scripts/score.py", "args": {...}}`.

⚠ **The runtime calls a function named `run`, whatever SKILL.md says.** A script that only
defines `severity_score(...)` fails at runtime with
`"Entry function 'run' not found in module 'score'"` (live-verified; IBM's own hello-world
`greet.py` has the same shape). The model's `args` arrive as **keyword arguments**, so
write a tolerant entry point and name its arguments in SKILL.md so the model sends the right keys:
```python
def run(gcs: int = 15, systolic_bp: int = 120, **_ignored) -> dict:
    return {"urgency": severity_score(int(gcs), int(systolic_bp))}
```
The return value comes back as `result` / `execution_output`, with `success`, `stdout` and
`error` beside it.

⚠ **`agents export` fails for any agent that has `skills:` (2.18.0 bug).**
`Failed to find skill. No skill found with the id 'ppth-diagnostics-protocol'`. The 2.18 CLI
deliberately skips skill name→UUID resolution on import (source comment: the server
rejected UUIDs on 2.16 tenants), so the agent stores the raw *name*. Export still tries
UUID→name and aborts. The runtime resolves the name fine (`load_skill` works). Until it
is fixed, keep the agent YAML in Git as the source of truth, and export skills separately
with `skills export`.

⚠ **Skills cost a turn at runtime (live-verified 2.13.0).** Attaching a skill adds a real
**`load_skill`** tool call to the run — it shows up in `step_history` as
`{"skill_name": "diagnostics-protocol", "params": {}}` followed by a `tool_response`, and the
skill body is then loaded into the system prompt. So a skill is not free: it costs a turn,
input tokens on every subsequent generation, and a little latency. Attaching six skills to
one agent is a real cost. Budget for it, and don't be surprised to see `load_skill` in traces.

⚠ **Naming gotcha (live-verified):** unlike every other wxO resource (which is
snake_case), an **agent-skill `name` must be kebab-case** — lowercase letters, digits, and
single hyphens only, no underscores, no leading/trailing/consecutive hyphens. Importing
`diagnostics_protocol` fails with *"Skill name … is invalid … (agentskills.io spec)"*; use
`diagnostics-protocol`. Import is **upsert-by-name** (same name updates in place; `--upsert`
makes that explicit). `agents list` now shows **Skills** and **Plugins** columns.

### 3.3d Agent versioning (NEW in 2.17.0): live-verified 2.18.0

Every agent has two **environments**, `draft` and `live`, and a list of immutable
**versions** (releases). `orchestrate agents deploy` releases the current draft as a new
version and points `live` at it. **The CLI has no other versioning verbs** (no
list/switch/delete-version); the rest is the REST API under
`<instance-url>/v1/orchestrate/agents`:

| Action | Call |
|---|---|
| Agent's environments (+ `current_version`) | `GET /{agent_id}/environment` |
| Release draft → new version | `POST /{agent_id}/releases` body `{"environment_id": "<live env id>", "comments": "…"}` → `201 {"released_agent_version": 2}` |
| List versions | `GET /{agent_id}/releases` (`version_label`, `instructions`, `tools`, `llm`, `deployment_statuses`…) |
| Get one version | `GET /{agent_id}/releases/{version}` |
| **Switch** an env to a version (rollback) | `POST /{agent_id}/releases/{version}/environment/{env_id}` → `{"Switched to Agent Version": 1}` |
| Undeploy | `POST /{agent_id}/releases/{version}/undeploy` |
| Delete a version | `DELETE /{agent_id}/releases/{version}` |
| Deployment status | `GET /{agent_id}/releases/status?environment_id=…` |
| All released agents in an env | `GET /environment/{live\|draft}/releases` |

Verified end to end: release v2 → live answered with v2 behaviour → switch to v1 → live
answered with v1 → undeploy → switch back to v2.

⚠ Gotchas (all live-verified 2.18.0):
- **Deleting the version that is currently live returns `204` without a guard.** `live` is
  left with `current_version: null`, which **silently undeploys the agent**. Switch first,
  then delete.
- **`deployment_status` on the versions list is stale.** After an undeploy, both versions
  still said `success`. The only truth is `current_version` from `GET /{agent_id}/environment`.
- **Version history is per draft.** `agents import` updates the draft but releases nothing.
  Users see a change only after `deploy` (or a `POST …/releases`).
- **Testing draft vs live is a real distinction now**, see §3.5.

### 3.4 Import (dependency-ordered)

```bash
orchestrate env activate local

# 1) connections first (tools/agents reference them)
orchestrate connections import -f connections/my_api.yaml

# 2) custom models (if any)
orchestrate models import -f models/granite.yaml --app-id watsonx_credentials

# 3) knowledge bases
orchestrate knowledge-bases import -f knowledge_base/kb.yaml

# 4) tools — link credentials with --app-id; python tools take -r
orchestrate tools import -k python -f tools/weather.py -r tools/requirements.txt
orchestrate tools import -k python -f tools/api_tool.py --app-id my_api

# 4b) MCP toolkits — group is `toolkits` (plural). `add` for inline config,
#     `import` for a pre-written MCP spec file. (see references/mcp-toolkits.md)
orchestrate toolkits add -k mcp -n my_toolkit --description "My MCP tools" \
  --package-root ./mcp_server --language node \
  --command '["node","dist/index.js","--transport","stdio"]' --tools "*"

# 4c) flows with agent nodes — import the agents they call FIRST (move those agent
#     imports up), then the flow; an agent that uses this flow as a tool comes after it.
orchestrate tools import -k flow -f tools/flows/second_opinion.py

# 5) agent skills (2.13.0) — before the agent that references them (§3.3c)
orchestrate skills import -d skills/diagnostics-protocol --upsert   # picks up scripts/ + references/

# 6) the agent
orchestrate agents import -f agents/weather_agent.yaml

# 7) controls LAST (2.15.0) — they bind to agents/tools/models by name, so those
#    must exist first. `controls import` is create-only: remove before re-running.
orchestrate controls remove -n weather_pii_guard 2>/dev/null || true
orchestrate controls import -f controls/weather_pii_guard.yaml
```

`tools import -k` accepts `python | openapi | flow | langflow`. Use `--safe` on
`tools`/`agents`/`knowledge-bases` import to be prompted before overwriting an
existing resource.

Never run `orchestrate import` directly. Put this code in `import-all.sh` instead
and run that script.

### 3.5 Test

```bash
orchestrate agents list                                 # confirm it imported; see real `name`s
orchestrate agents list -v                              # full JSON incl. ids
```
> **Always parse `agents list -v` as JSON — never read the table.** The rich table wraps
> every column to roughly *one character per line* at normal terminal width, so a tenant with
> more than a handful of agents produces hundreds of lines of unreadable output. The same
> applies to `tools list`, `skills list` and `traces search`. Where a command has
> `-f/--format json` use it; otherwise set `COLUMNS=200` to widen the render.
- **Reference agents/tools by their `name` (snake_case), never the display name.**
  e.g. an agent shown as "FM - Aegis" may have `name: FM_3009a0` — `-n "FM - Aegis"`
  will fail. Find the real `name` with `agents list -v`, or export it:
  `orchestrate agents export -n <name> --kind native -o agent.yaml --agent-only`.
- MCP-toolkit tools appear namespaced in listings as `toolkit_name:tool_name`.

**Verify before handover (post-deploy gate)**

*Deployed ≠ verified.* Never report an agent as "done" or "ready for handover"
until it has been tested — or the human explicitly declined. 

To test the agent, Orchestrate assets have to be imported/deployed first: 
Run `import-all.sh`.

After deploy, **ask first**, then prove it works:

> "`<agent>` is deployed to `<env>`. Want me to smoke-test it before handover? I'll
> run 1 single-turn + 1 multi-turn test against `<env>` — this sends real prompts
> and may invoke its tools, so I'll keep to **read-only** prompts." — Yes / No

If yes, derive the tests from the agent's own spec (`description`, `instructions`,
`tools`, and especially `starter_prompts` — those *are* example user prompts).
Make the follow-up **context-dependent** (e.g. *"which movie was it written for?"* —
"it" only resolvable from turn 1).

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
# Single-turn (1) — --live = test the DEPLOYED version (see the draft/live note below)
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n <agent> --live -r "<derived single-turn prompt>"
# → { "thread_id": "3f92692d-...", "final_message": "...", ... }

# Multi-turn (2a) — initial user input
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n <agent> --live "<derived multi-turn prompt>"
# → { "thread_id": "3f92692d-...", "final_message": "...", ... }

# Multi-turn (2b) — resume
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n <agent> --live --thread-id <thread-id> -r "<second user input>"
# → { "thread_id": "3f92692d-...", "final_message": "...", "reasoning_trace": {"steps": [...]}, ... }
```

⚠ **Draft vs live (live-verified 2.18.0).** Without `--live`, the runs API executes the
agent's **draft**. With the draft and live intentionally different, the results were:

| Call | Answered with |
|---|---|
| `wxo-chat.sh` (no flag) = `POST /orchestrate/runs` without `environment_id` | **draft** |
| `POST /orchestrate/runs` with `"environment_id": "<live env id>"` (`--live`) | **live** |
| `POST /{v1,v2}/orchestrate/{agent_id}/chat/completions` (even with `?environment_id=`) | **draft** |

So the post-deploy gate must use `--live`, or it proves the draft works, not what users of
the deployed agent get. Use the default (draft) mode while iterating *before* a deploy.
`--live` fails fast with a clear message if the agent has no live version.

Reading the trace: each `tool_calls` step carries an **`agent`** field (the display name of
the agent that made the call). A delegation appears as the orchestrator calling
`chat_with_collaborator_…` followed by the collaborator's own tool call (§3.3b).

**Pass = behavior, not exact text** (LLMs are non-deterministic): no error,
on-topic, the **expected tool was called** (visible via `-r`; `-l` for custom
agents), and the multi-turn follow-up **uses prior context**. Then emit a short
`temp/TEST_REPORT.md` (prompts, response excerpts, tool-call evidence, env, timestamp,
pass/fail) and **report status honestly**: "deployed and tested (2/2)", "deployed;
test 2 failed — …", or "deployed; not tested at your request".

**Safety:** keep tests **read-only by default** — if the agent has `READ_WRITE`
tools, do not craft prompts that trigger writes unless the human opts in. Full
recipe + report template: **[references/testing-debugging.md](references/testing-debugging.md)**.

### 3.6 Debug → Publish

Debugging in §6; promoting to a production instance in §7. **Run the §3.6 gate (or
record that the human declined) before §7 handover.**

---

## 4. Models / LLMs

- List what the active environment offers: `orchestrate models list`.
- Reference models in agent YAML by their full id, e.g.
  `watsonx/meta-llama/llama-3-3-70b-instruct`, `watsonx/ibm/granite-3-3-8b-instruct`,
  or a gateway provider like `groq/openai/gpt-oss-120b`.
- Use `groq/openai/gpt-oss-120b` as default model if available.
- The `experimental_customer_care` agent style expects `groq/openai/gpt-oss-120b`.
- **Premier models are disabled by default** — enable them at the tenant level before
  referencing one, or `models list` won't surface it (the list legend marks premier with
  `$`). 2.13.0 adds **GPT-5.4** and other premier models. Commands (live-verified 2.13.0):
  ```bash
  orchestrate models config are-premier-models-enabled   # → "Premier models enabled: False"
  orchestrate models config enable-premier-models        # tenant-wide opt-in
  orchestrate models config disable-premier-models
  ```
- **Gemma 4 31B on AWS Bedrock (2.18.0, public preview):** `llm: bedrock-mantle/google.gemma-4-31b`.
  ReAct Core is applied automatically. ⚠ Live-verified on a SaaS tenant whose
  `models list` showed only `groq/openai/gpt-oss-120b`, `bedrock/openai.gpt-oss-120b-1:0` and
  `watsonx-orchestrate/frontier`: the Gemma agent **still imported, deployed and answered**,
  and the trace's `observation.model` was `google.gemma-4-31b`. So **`models list` is not the
  full set of usable models**, and **`agents import` does not validate `llm`** (a typo imports
  fine and fails only at chat time). Confirm a model with one real chat, not with `models list`.
  In Developer Edition it appears only when `BEDROCK_AWS_ACCESS_KEY_ID` +
  `BEDROCK_AWS_SECRET_ACCESS_KEY` are in `.env`.
- **Azure authentication modes (2.17.0):** API key, managed identity and Microsoft Entra ID.
  ⚠ In the 2.18.0 ADK the auth fields (`azure_auth_mode`, `azure_managed_client_id`,
  `azure_entra_client_id`, `azure_entra_client_secret`, `azure_entra_tenant_id`,
  `azure_ad_token`, `ad_auth`) belong to provider **`azure-ai`**. On **`azure-openai`**, which
  takes only `azure_resource_name`, `azure_deployment_id`, `azure_api_version` and
  `azure_model_name`, the ADK warns *"The config option 'azure_auth_mode' is not used by
  provider 'azure-openai'"* and the setting is ignored. Use `azure-ai/<model>` for Entra/MI
  (source-verified, not live-run).
- **New provider `redhat-ai`** (2.14.0). The release note calls it `red_hat_ai`; the
  actual `ModelProvider` enum value is **`redhat-ai`** — use that in `kind: model` YAML.
  Full provider list in [references/connections-models-kb.md](references/connections-models-kb.md).
- **External agents** gained the **`msftstudio`** provider (Microsoft Copilot Studio;
  the release note calls it `microsoft_copilot_studio`) alongside `salesforce`,
  `external_chat`, `wx.ai` and A2A `0.2.1`/`0.3.0`.
- Prebuilt **domain agents are multi-provider**: `gpt-oss-120b` via Groq on
  AWS/IBM Cloud, via watsonx.ai on on-prem/GovCloud — pick the id that `models list`
  actually shows for your deployment.
- To add your own watsonx.ai model you create a `watsonx_credentials` connection,
  then a `kind: model` YAML, then `orchestrate models import`. Full walkthrough
  (provider schema, space/project/deployment, CPD on-prem) is in
  **[references/connections-models-kb.md](references/connections-models-kb.md)**.

---

## 4a. Controls — policy guardrails on agents, tools and models (NEW in 2.15.0)

A **control** binds a *policy artifact* (a PII filter, a content guardrail, a rate
limiter…) to one or more **agents, tools or models**, at a named **execution hook**.
This is how you put a hard, platform-enforced boundary around an agent instead of
asking the model nicely in `instructions:`.

```bash
orchestrate controls list-types                    # what policy artifacts exist here
orchestrate controls get-type -n pii_filter -v     # → the artifact's JSON config_schema
orchestrate controls create -a "PII Filter" -n house_pii_guard \
  --hook agent_pre_invoke --hook agent_post_invoke --priority 50 \
  --config '{"detect_ssn": true, "detect_email": true, "default_mask_strategy": "redact"}' \
  --agent dr_house
orchestrate controls list [--agent X|--tool Y|--model Z|--artifact A] [-v]
orchestrate controls get-details -n house_pii_guard -v
orchestrate controls count                         # totals per asset type
orchestrate controls update  -n house_pii_guard --priority 10 --config '{…}'
orchestrate controls export  -n house_pii_guard -o control.yaml
orchestrate controls import  -f control.yaml
orchestrate controls remove  -n house_pii_guard
```

> The release note lists `list`, `list-types`, `get-type`, `create`, `delete`. The real CLI
> has **ten** commands and the delete verb is **`remove`**, not `delete`.

**Execution hooks** (server-validated — an invalid one is a clean 422 naming all six):
`agent_pre_invoke`, `agent_post_invoke`, `tool_pre_invoke`, `tool_post_invoke`,
`prompt_pre_fetch`, `prompt_post_fetch`. `--priority` orders them; **lower runs first**
(default 100).

**Policy artifacts on IBM Cloud SaaS** (`list-types`, live 2.15.0). Each is valid only for
the asset types listed — `get-type -n <name> -v` prints its `asset_type` and full
`config_schema`:

| Artifact (`name`) | Display | Binds to | Config highlights |
|---|---|---|---|
| `pii_filter` | PII Filter | agent | `detect_ssn/email/phone/credit_card/passport/medical_record/…`, `default_mask_strategy: redact\|partial\|hash\|tokenize\|remove`, `redaction_text`, `block_on_detection`, `custom_patterns`, `allowlist_patterns` |
| `Guardrails` | Content Guardrails | agent, tool | `enabled.{sexual_content,violence,hap,harm,jailbreak,social_bias}`, `block_message` |
| `RegexPattern` | Regex Pattern | agent | `regex_patterns[]` (required), `strategy: redact\|block`, `redaction_text` |
| `SecretsDetection` | Secrets Detector | agent, tool | per-type toggles (`private_key_block`, `jwt_like`, `hex_secret_32`, …), `redact`, `block_on_detection`, `min_findings_to_block` |
| `OutputLengthGuardPlugin` | Output Length Guard | agent, tool | `limit_mode: character\|token`, `strategy: truncate\|block`, `ellipsis`, `word_boundary` |
| `RateLimiterPlugin` | Rate Limiter | tool | `by_tool` (req/min, default 30), `by_tenant` (default 3000) |
| `SQLSanitizer` | SQLSanitizer | tool | detects risky SQL; strip comments or block |
| `fallback` / `load_balance` / `retry_mode` | Fallback / Load Balance / Retry | model | failover, weighted distribution, retry-on-status |

### It genuinely enforces — A/B proof (live-verified 2.15.0)

Same agent, same prompt, control on vs. off:

| | Control OFF | Control ON |
|---|---|---|
| Answer | repeated `SSN 123-45-6789`, the email and the phone verbatim | *"I'm sorry, but I can't repeat that personal health information."* |
| Trace | raw identifiers present | `SSN [PHI-REDACTED]`, `email [PHI-REDACTED]` — **the raw values never reach the model** |

The filter rewrites the payload at `agent_pre_invoke`, so the model never sees the PII and
declines on its own. Two consequences worth knowing: the refusal **looks like a model
refusal**, not a policy block (check the trace before you "fix" the prompt), and the
redaction is visible in `observability traces export`, which is the fastest way to confirm
a control is live.

### Four things `controls` accepts silently — all live-verified

These fail *quietly*, at create time, and only show up as a control that does nothing:

1. **`--config` is NOT validated against `config_schema`.** A bogus key (`mask_strategy`
   instead of `default_mask_strategy`) and a bogus enum value (`"NOT_AN_ENUM_VALUE"`) were
   both stored verbatim, HTTP 200. **Read `get-type -n <artifact> -v` and copy the key
   names exactly** — a typo means the control runs with schema defaults, i.e. everything
   off. (Contrast: `--hooks` *is* validated.)
2. **Asset-type mismatches are accepted.** `RateLimiterPlugin` is `asset_type: ["tool"]`,
   yet binding it to an `--agent` on an agent hook succeeded. Check `asset_type` yourself.
3. **A control with no binding at all is accepted** — it counts in `controls count` totals
   but appears under no asset bucket. If `Total` exceeds `Agent + Tool + Model`, you have
   orphans.
4. **`controls import` is create-only, not upsert.** Re-running it fails with
   `400 Policy binding with name "X" already exists` — there is no `--upsert`. In
   `import-all.sh`, `controls remove -n X` first (ignoring failure) or use
   `controls update`.

### ⚠ `export` → `import` does not round-trip

`controls export` writes the agent's **display name**:

```yaml
agent_names:
- Dr. House (Diagnostics Lead)      # ← what export emits
```

…but `controls import` resolves `agent_names` against the **snake_case `name`**, so
re-importing your own export fails:

```
No agent found with name 'Dr. House (Diagnostics Lead)'
```

**Fix: rewrite `agent_names` to snake_case before importing** (`- dr_house`). With that
one substitution everything else round-trips faithfully — hooks, priority, config, and
`artifact_name` given as either the display name (`PII Filter`) or the internal name
(`pii_filter`). Keep hand-written control YAML in Git; treat `export` as a read-only
inspection tool.

Authoring format (what `import` actually wants):

```yaml
spec_version: v1
kind: control
control:
  artifact_name: pii_filter          # internal name or display name
  name: house_pii_guard
  display_name: House PII Guard
  description: Redact patient PHI on the diagnostics agent
  hooks: [agent_pre_invoke, agent_post_invoke]
  priority: 50
  config:
    detect_ssn: true
    default_mask_strategy: redact
    redaction_text: "[PHI-REDACTED]"
  agent_names: [dr_house]            # snake_case! also tool_names / model_names
```

`controls update` **replaces** rather than merges: `--hooks`, `--config`, `--agent`,
`--tool` and `--model` each overwrite the previous value wholesale, while any flag you
*omit* is preserved. Each update bumps the control's `version`.

---

## 4b. Voice configuration (2.14 → 2.15 additions)

`orchestrate voice-configs import|list|get|export|remove`. Attach to an agent with
`voice_configuration: <name>`.

⚠ **Provider strings are `<vendor>_stt` / `<vendor>_tts`, not the bare vendor.**
`provider: deepgram` fails server-side with the misleading
`deepgram_config must be specified for deepgram` — the correct value is `deepgram_stt`.
The ADK models `provider` as a free string with no enum, so a wrong value only surfaces as
a 422 from the platform.

```yaml
spec_version: v1
kind: voice_configuration
name: front_desk_voice
speech_to_text:
  provider: deepgram_stt
  deepgram_stt_config:
    api_key: …
    api_url: wss://api.deepgram.com/v2/listen   # REQUIRED — omitting it is a pydantic error
    model: flux-general-en          # 2.15.0 fix: flux-* no longer raises a false warning
    language: en
text_to_speech:
  provider: deepgram_tts
  deepgram_tts_config:
    model: aura-2-zeus-en
    normalize_volume: true          # 2.14.0 — auto-levels the output audio
user_idle_handler:
  enabled: true
  idle_timeout: 8                   # seconds before the handler fires
  idle_max_reprompts: 2
  idle_timeout_message: Are you still there?
  idle_hangup_message: I will close the line for now.
  use_llm_generated_idle_message: false   # 2.15.0 — false = use the static message above
  repeat_previous_message: false          # 2.15.0 — false = don't replay the last agent turn
agent_idle_handler:
  typing_enabled: true
  typing_duration_seconds: 5
  audio_clip_id: guitar_1           # guitar_1 | listen_1 | silence | custom
  hold_audio_seconds: 15
  long_running_task_seconds: 3      # 2.15.0 — processing time before the pre-hold message
  pre_hold_message: Pulling the chart now, one moment.
  hold_message: Still working on it. Thanks for your patience.
```

All of the above round-trips through `voice-configs export` (API keys are stripped).

⚠ **Google TTS (2.14.0) was rejected by the SaaS backend at time of writing.** The ADK
serialises `google_tts_config` correctly (verified against `TextToSpeechConfig`), but the
platform answered `422 google_tts_config must be specified for google_tts`. Treat Google
TTS as **doc-sourced, not live-verified**, and confirm on the target tenant before
promising it. Its fields: `voice`, `language`, `speaking_rate` (0.25–4.0), `pitch`
(-20–20), `volume_gain_db` (-96–16), `ssml_gender`, `effects_profile_id`, plus **exactly
one** of `credentials_json` / `api_key`.

---

## 5. Critical constraints (these cause silent failures — internalize them)

**Python tools**
- ✅ Every callable that becomes a tool **must** be decorated with `@tool`.
- ✅ Use **Google-style docstrings**: a summary, then `Args:` (each as
  `name (Type): desc`), then `Returns:` (`Type: desc`). **No blank line between
  the `Args:` and `Returns:` blocks** — extra blanks break the parser.
- ✅ Every parameter and the return value **must have type hints**, matching the docstring.
- ✅ Each tool file must be **self-contained**: only stdlib, common third-party
  (`requests`, `pydantic`, …), and `ibm_watsonx_orchestrate` imports. **No
  cross-file local imports** (`from .utils import x` / `from tools.shared import y`).
- ✅ Credentials are **never** function parameters. Declare `expected_credentials=[…]`
  on `@tool` and fetch at runtime via `ibm_watsonx_orchestrate.run.connections`.
- ✅ Define Pydantic models as explicit classes — never `type(...)` dynamic creation.
- ✅ Never add `ibm-watsonx-orchestrate` itself to a tool's `requirements.txt` — the runtime 
  provides it.

**Flows**
- ✅ Signature is exactly `def build_<flow_name>(aflow: Flow) -> Flow:` — param
  named `aflow`, returns the flow, function name starts with `build_`.
- ✅ One flow per file. Wire with `aflow.sequence(START, …, END)` / `aflow.edge(...)`.
- ✅ `map_output` / `map_input` expressions are **single-line** — no function defs/calls.
- ✅ `aflow.prompt(...)` requires a `system_prompt`.
- ✅ A user **activity** holds exactly **one** widget; use `form()` for multi-field layouts.
  For `message_output_field` pass `text=` (`label` is ignored on activities) (§3.2a).
- ✅ `thread_control_policy` is `"REUSE_AND_CORRELATE"` or `"CREATE_ALWAYS"` (string literal).
- ✅ Import `flow_builder.flows` **before** `flow_builder.types` in scripts (circular import).

**Agent YAML**
- ✅ `spec_version: v1` and `kind: native` are mandatory — omitting them fails import.
- ✅ `tools`/`collaborators`/`knowledge_base`/`skills` list resources **by name**; the
  referenced resources must already be imported.
- ✅ `style`: default is **`react_core`** (2.13.0). `default`, `react`, `planner` still
  import but log a deprecation warning — prefer `react_core`.
- ✅ `skills:` names are **kebab-case** (agentskills.io spec) — every *other* resource name
  is snake_case, but a skill named with an underscore is rejected (§3.3c).
- ✅ `toolkits` are only valid for `experimental_customer_care` style (and the
  schedulable-agent exception).

**Connections YAML**
> 🔐 **Choosing *which* auth kind, `member` vs `team`, RBAC, or per-user identity?** That is
> the **[`watsonx-orchestrate-aaa`](../watsonx-orchestrate-aaa/SKILL.md)** skill — load it
> alongside this one. This section covers the *mechanics*; that skill covers the decision,
> the access-surface constraints, and what identity actually reaches your tools.

- ✅ `kind: connection` (singular). Inside `environments.<env>` use
  `security_scheme:` (not `kind:`). At minimum a `draft` environment.
- ✅ OAuth2 needs `auth_type: oauth2_auth_code` (not `authorization_code`).
- ✅ YAML defines *structure*; real secrets are set with
  `orchestrate connections set-credentials`. Never hardcode secrets.
- ⚠ **Custom API-key header (2.15.0) — accepted by the CLI, BROKEN on the SaaS backend.**
  `connections configure -a <app> --env draft -t team -k api_key -u <url> --name "X-Auth-Token"`
  is supposed to replace the default `api_key` header. Live-verified 2.15.0 on IBM Cloud SaaS:
  the **create** path reports success but stores nothing (`connections export` emits no
  `name`), and the **update** path fails outright:
  ```
  500 CM-UNKNOWN-001 … details: column "name" of relation
      "application_connection_configs" does not exist
  ```
  The same update **without** `--name` succeeds, so the flag itself is the trigger — the
  backend schema has not caught up with the CLI. **Do not depend on a custom header name
  until you have verified it on the target tenant.** If the API needs a non-default header,
  fall back to `--kind key_value` with an explicit entry, or send the header from the tool
  code. (`--name` is also rejected outright on any kind other than `api_key`.)
- ✅ **OAuth 2.0 JWT Bearer (2.16.0)**, for service-to-service calls with a signed assertion.
  Live-verified 2.18.0:
  ```bash
  orchestrate connections add -a lab_api
  orchestrate connections configure -a lab_api --env draft -t team \
    -k oauth_auth_jwt_bearer_flow -u https://lab.example.com
  orchestrate connections set-credentials -a lab_api --env draft \
    --client-id my-client --token-url https://idp.example.com/oauth/token \
    --alg RS256 --private-key "$(cat key.pem)" --kid key-1 \
    --exp 900 --include-jti --claims dept=diagnostics --claims site=ppth
  # optional: --iss (defaults to client_id), --aud (defaults to token_url), --private-key-password
  ```
  Gotchas: **`-t team` only**, since `member` is rejected client-side.
  **`--private-key` takes the PEM *contents***; a file path fails server-side with
  `Invalid private_key: … DECODER routines::unsupported`. **`--alg` must be RS256/RS384/RS512**
  (`HS256` → 400). **The backend calls the token URL during `set-credentials`.** An unreachable
  IdP returns a `503 … ENOTFOUND` error, yet the credentials are still saved, so read
  the final log line and don't assume the error meant nothing was stored.

**Controls (2.15.0)** — full section in §4a
- ✅ `--config` is **not** validated: copy key names from `controls get-type -n <a> -v`.
- ✅ `--hooks` **is** validated; `--priority` is lower-runs-first.
- ✅ `controls import` is create-only — `remove` first when re-running an import script.
- ✅ `controls export` emits agent **display** names; rewrite them to snake_case before import.

Remember: After code generation always deploy/import and runs tests (see 3.5 Test)

---

## 6. Debugging playbook

| Symptom | Likely cause → fix |
|---------|--------------------|
| `agents import` fails on required field | Missing `spec_version`/`kind`/`name`/`description`, or a referenced tool/KB not imported yet. Import dependencies first. |
| Tool imports but agent never calls it | Vague tool `description`/docstring, or instructions don't mention it. Make the docstring action-oriented; name the tool in `instructions`. |
| Type-hint / docstring parser warnings | **First check it's not a false positive.** In ADK 2.12 `tools import` prints `"Unable to properly parse parameter descriptions due to missing or incorrect type hints"` for *every* Python tool — even correct ones (the descriptions still parse fine; live-verified). Only act if the parsed schema is actually missing descriptions. *Real* causes: missing type hints, or a blank line between `Args:` and `Returns:` (§5). |
| "name cannot contain spaces" | Tool/toolkit/agent `name` must be snake_case, no spaces. |
| Skill import: "Skill name … is invalid … (agentskills.io spec)" | Agent-skill `name` must be **kebab-case** (lowercase/digits/single hyphens) — not snake_case. Rename `foo_bar` → `foo-bar` (§3.3c). |
| Deprecation warning on agent import ("style … set to be deprecated") | You used `default`/`react`/`planner`. Switch `style:` to **`react_core`** (2.13.0 default). |
| Missing dependency at tool runtime | Add it to the tool's `requirements.txt` and re-import with `-r` (never add `ibm-watsonx-orchestrate`). |
| 401/403 on a tool call | Connection not configured/credentialed, or wrong `app_id`. `orchestrate connections list`; re-run `set-credentials`. |
| Works locally, missing in prod | Wrong active env. `orchestrate env list` → `orchestrate env activate <remote>`, then re-import. |
| `No agents with the name 'X' found` | You used the display name. Use the snake_case `name` from `orchestrate agents list -v` (display "FM - Aegis" → `name: FM_3009a0`). |
| Orchestrator answers instead of delegating | Look at the **orchestrator's own `instructions`** first — a sentence permitting self-answer suppresses routing. Playbook: [testing-debugging.md](references/testing-debugging.md) §2a. |
| Routing assertion fails though delegation happened | On 2.18 the collaborator tool is named from the **display name** slug (`chat_with_collaborator_dr_james_wilson_oncology`). Assert on the next step's `agent` field or the display-name slug (§3.3b). |
| Test passes but users still see the old behaviour (or vice versa) | You tested the **draft**. Runs/chat-completions default to draft; re-test with `wxo-chat.sh --live` (§3.5). |
| Agent stopped answering on live after a version cleanup | You deleted the version `live` pointed at; `current_version` is now `null`. `agents deploy` or switch to another version (§3.3d). |
| `agents export` → `No skill found with the id '<skill-name>'` | 2.18.0 bug: agents with `skills:` can't be exported. Keep the YAML in Git; `skills export` works (§3.3c). |
| `execute_skill_script` → `Entry function 'run' not found in module '<x>'` | The skill-script runtime calls `run(**args)`. Add a `run` function that wraps your logic (§3.3c). |
| `tool_shortlisting` has no effect | It only acts on `/v2/orchestrate/{id}/chat/completions`; runs API and v1 ignore it. Compare `usage.input` on a v2 call (§3.3a). |
| `custom_agents_metadata` missing / extra `null` keys | External agents: dropped server-side, so use `tags`. Native: the six reserved `null` keys are injected by the server; ignore them (§3.3a). |
| JWT connection `Invalid private_key … DECODER routines::unsupported` | You passed a path; pass the PEM contents: `--private-key "$(cat key.pem)"` (§5). |
| Agent imported with a model `models list` doesn't show | `agents import` doesn't validate `llm`. Prove the model with one chat; e.g. Gemma 4 works without being listed (§4). |
| Need to see the agent's reasoning | `orchestrate chat ask -n <agent> "…" -r` (`-r` = reasoning, `-l` = capture logs for custom agents). ⚠ `chat ask` **hangs on IBM Cloud SaaS** — use the runtime API or `wxo-chat.sh` there. |
| Need token counts | 2.18.0: `run.usage.token_usage` (runs API) and `usage` (v1 chat completions) now carry run totals incl. `cached_tokens`; v2 chat completions has none. Per-LLM-call detail stays in the trace: `observation.usage` on `GENERATION` (§6a). |
| Need to know why a run was slow | AgentOps v3 trace + the outer-vs-inner span rule (§6a). |
| Control created but has no effect | `--config` isn't schema-validated — a mistyped key is stored verbatim and the artifact runs on defaults (everything off). Diff your config against `controls get-type -n <artifact> -v` (§4a). |
| `controls import` → `400 … already exists` | Import is create-only, not upsert. `controls remove -n <name>` first (§4a). |
| `controls import` → `No agent found with name 'Display Name'` | You re-imported a `controls export`, which writes **display** names. Rewrite `agent_names` to snake_case (§4a). |
| Agent suddenly refuses a normal request | Check for a bound control before touching the prompt — a PII/guardrail control rewrites or blocks at `agent_pre_invoke`, and the model's refusal looks like a model refusal. `controls list --agent <name>`, then read the trace: redacted text shows up as `[REDACTED]` in the LLM input (§4a). |
| `agents import` → `At most 100 characters … Welcome message` | Older tenant (≤2.15). 2.18.0 accepts longer messages; on an old tenant keep `welcome_message` ≤100 chars and move the prose to `description` (§3.3). |
| KB import → `Unsupported file type text/markdown` | Built-in ingestion rejects `.md`. Rename to `.txt` (PDF/DOCX/PPTX/XLSX/CSV/HTML/TXT are accepted) (§3.3). |
| Agent only searches one of several KBs | Each KB is a separate retrieval tool routed on its `description`. Make the descriptions mutually exclusive and tell the agent in `instructions:` that cross-cutting questions must consult both (§3.3). |
| Voice config → `<vendor>_config must be specified for <vendor>` | The `provider` string must be `<vendor>_stt` / `<vendor>_tts` (e.g. `deepgram_stt`), not the bare vendor name (§4b). |
| `agents export -o x.zip` or `-o x.yaml` rejected | `--agent-only` requires **`.yaml`**; the full dependency bundle (no `--agent-only`) requires **`.zip`**. The two are not interchangeable. |
| `agents list` unreadable | Table wraps to ~1 char/column. Parse `agents list -v` JSON, or set `COLUMNS=200` (§3.5). |
| Inspect server | `orchestrate server logs`; `orchestrate server reset` to wipe state; `orchestrate server stop`. |

---

## 6a. Observability & cost — what wxO gives you, and what it doesn't

Every completed run carries a **`trace_id`**. That is your handle on everything below.
Full field maps, the span-tree rule and the cost model:
**[references/agentops-evaluations.md](references/agentops-evaluations.md) §4–§7**.

**Three surfaces, increasing detail** — pick deliberately:

| Surface | Gives you |
|---|---|
| `GET /v1/orchestrate/runs/{id}` | status, `trace_id`, `thread_id`, `step_history`, and since 2.18.0 **`usage`** (run totals + per-model `model_usage[]`, incl. `cached_tokens`). **No timings.** |
| `orchestrate observability traces export --trace-id` | 11 observation fields — fine for a token count or a quick look. **No `latency`, no span tree.** |
| `GET /v1/agentops-v3/traces/{trace_id}` | +30 fields: `latency`, `parentObservationId`, `level`, cost fields, `scores[]`. **Use this to explain a number.** |

**Native (just read it):** end-to-end and per-span latency · per-call token counts · model id ·
`sessionId`/`userId` · the span tree · sampled LLM-judge `scores[]` · routing accuracy from
`evaluations`.

**Not native (you build it):**

- **Cost.** `trace.totalCost` returns **`0`** — no price sheet is attached. **Tokens are
  exact; pricing is yours.** Multiply `usage` by a rate card keyed on `observation.model`.
  Expect input tokens to dominate (~**9:1** measured on a multi-agent session) — delegation
  re-sends context, and loaded skills sit in every prompt.
- **Error rate, tail latency, tool-call success.** Derive from runs and traces. Exclude the
  sub-second infrastructure traces (blank agent name) that `traces search` returns.
- **Dashboards.** **None ship.** No error-rate panel, no latency histogram, no tool-success
  view. State this in scoping before a customer assumes otherwise.

**Latency triage in one rule:** sort observations by `latency`, rebuild the tree with
`parentObservationId`, then — *outer span ≫ inner span → the time is in the platform*
(cold start, queueing); *outer ≈ inner → the time is in your code or what it calls*. The two
have completely different fixes, and only the v3 API can tell them apart.

⚠ Fields on the v3 API are **camelCase** (`startTime`, `totalCost`, `parentObservationId`) —
unlike every other wxO payload. Snake_case guesses silently return `None`.

Iterate fast: edit → re-`import` (overwrites by name) → re-test in chat. Use
`orchestrate agents export -n <name> --kind native -o agent.yaml --agent-only` to
snapshot a working definition into Git, and `--safe` on imports to avoid clobbering.

More: **[references/testing-debugging.md](references/testing-debugging.md)**.

---

## 6b. Observability for agents running OUTSIDE wxO (2.14 → 2.15)

An agent that runs on your own infrastructure (LangGraph, CrewAI, a plain script) can now
push its execution traces **into the wxO Agent Analytics dashboard**, so external and
native agents show up side by side. Two routes:

**1. OpenTelemetry export** — any language, any framework, standard OTel SDK:
```bash
pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp-proto-http
```
Point the OTLP/HTTP exporter at
`<instance-url>/v1/orchestrate/inject/traces` with `Authorization: Bearer <token>`
(exchange your API key at the IAM/MCSP token endpoint). Environment it expects:
`TENANT_ID` (`<account-id>_<instance-id>`), `AGENT_ID`, `ENVIRONMENT_NAME` (`draft`/`live`),
and `OTEL_RESOURCE_ATTRIBUTES="tenant.id=$TENANT_ID,deployment.environment=$ENVIRONMENT_NAME"`.
Set `agent.id`, `langfuse.session.id` and `langfuse.user.id` on the **root span** — those are
what the dashboard groups on. **Always `force_flush()` before the process exits** or the
last trace is lost.

**2. Observability SDK** — decorator-based, aimed at LangGraph:
```bash
pip install -i https://test.pypi.org/simple/ ibm-watsonx-orchestrate-sdk   # Test PyPI pre-release
```
```python
from ibm_watsonx_orchestrate_sdk.client import Client
from ibm_watsonx_orchestrate_sdk.observability import Tracer, TracerConfig, register_tracer
from ibm_watsonx_orchestrate_sdk.observability.decorators import (
    configure_tracing, trace_agent_call, trace_llm_call, trace_tool_call, trace_call,
)
```
`TracerConfig(client=…, agent_id=…, workspace_id=…, environment="live", tenant_id=…)`, then
`register_tracer(tracer)` once at module load. Decorate the graph factory with
`@configure_tracing`, the top node with `@trace_agent_call`, and LLM/tool calls with
`@trace_llm_call` / `@trace_tool_call`. Automatic token refresh, root-span creation, tool
attributes and PII decorators are built in; export also works to any OTEL backend
(Jaeger, Instana).

⚠ **Both are doc-sourced, not live-verified here.** The SDK ships from **Test PyPI** as a
pre-release — pin it and re-check the package name before putting it in a customer build.

---

## 7. Publishing to production

There is **no `publish` verb** — publishing = activating the target environment
(SaaS or on-prem, see §2a), re-importing the artifacts there, and deploying.

> **Never hand over an untested agent.** Run the §3.6 verification gate after
> deploy (or record that the human declined). "Deployed" is a fact about the
> platform; "verified" is a fact about behavior — only the latter is handover-ready.

```bash
# 1) Activate the target env (registered once per §2a)
orchestrate env activate prod         # SaaS or on-prem

# 2) Re-import the same artifacts (connections → models → KB → tools → agent),
#    setting that env's credentials: orchestrate connections set-credentials ...
./import-all.sh

# 3) Deploy / retire an agent
orchestrate agents deploy   -n weather_agent      # releases the draft as a NEW VERSION and makes it live
orchestrate agents undeploy -n weather_agent

# 4) Verify the deployed version, not the draft (§3.5)
./.bob/skills/watsonx-orchestrate/references/wxo-chat.sh -n weather_agent --live "…"
```

**Rollback = switch versions (2.17.0+).** Each `deploy` creates a version. To roll back,
don't re-import the old YAML: point `live` at the earlier version through the REST
releases API (`POST /agents/{id}/releases/{version}/environment/{live_env_id}`, §3.3d).
Never delete the version that is currently live.

Keep **one** set of YAML/Python artifacts; only connection **credentials** and
model `provider_config` differ per environment. Version the artifacts in Git and
treat `import-all.sh` as the source of truth for promotion across dev → SaaS/on-prem.
`orchestrate channels` exposes a deployed agent on channels such as embedded web chat.

### Embedded web chat (the channel for chat_with_docs uploads)

Generate a drop-in `<script>` snippet for a **deployed** agent:
```bash
orchestrate channels webchat embed --agent-name <agent> --env live   # or draft
```
Paste the snippet into a page with a `<div id="root">`; it loads
`<hostURL>/wxochat/wxoLoader.js?embed=true` and renders the launcher. This is the
**right surface for `chat_with_docs`** — the upload widget here triggers ingestion,
which the raw runs API does not (§8).

⚠ **CRN gotcha (live-verified 2.12.0 SaaS):** the command auto-fetches the instance CRN
from the IBM Cloud resource-controller, which **403s with an instance-scoped API key**
and then prompts interactively (aborts in scripts). The CRN is in the bearer token's
`unique_instance_crns` claim — extract it and pipe it in:
```bash
CRN=$(python -c "import yaml,os,json,base64;t=yaml.safe_load(open(os.path.expanduser('~/.cache/orchestrate/credentials.yaml')))['auth']['<env>']['wxo_mcsp_token'];p=t.split('.')[1];p+='='*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p))['unique_instance_crns'][0])")
echo "$CRN" | COLUMNS=400 orchestrate channels webchat embed --agent-name <agent> --env live
```
Paste the emitted snippet into any page with a `<div id="root">` to render the launcher.

⚠ **Two more webchat gotchas (live-verified 2.13.0):**

- **`COLUMNS=400` is not optional.** The CLI renders the snippet through rich at your
  terminal width, so without it the JavaScript arrives **hard-wrapped mid-string** (the CRN
  and `orchestrationID` split across lines) and the page fails silently. Always widen, then
  extract with `sed -n '/<script>/,/<\/script>/p'`.
- **The embed 401s from an unauthenticated origin.** The loader fetches, `wxoLoader.init()`
  runs and the **launcher renders** — then every backend call returns `401` and the chat
  never connects:
  ```
  [warn]  [WxOChat] Remote landing not available in this environment
  [error] Failed to load resource: the server responded with a status of 401 ()
  ```
  This is **not** a missing channel: `channels create --type webchat` explicitly refuses with
  *"Webchat channels cannot be created using the 'create' command. Webchat is automatically
  available for all agents."*, and `channels list-channels` legitimately reports
  *"No channels found"*. It is authentication — the embedded chat expects an authenticated
  session against the tenant. **Serving it to anonymous users is configured in the watsonx
  Orchestrate UI (web chat security / allowed origins); the ADK does not expose it.** Budget
  for this: "paste the snippet and it works" holds only inside an authenticated context.

---

## 8. Embedding agents in your application (runtime REST API)

This is for **consuming a deployed agent from your own app** — a web/mobile
backend, service, IDE, or another agent owns the UX and calls wxO like any backend
service. It is **distinct from the embedded web-chat widget** (that's a *channel*,
§7 / `orchestrate channels`, a drop-in UI you don't code against).

wxO exposes a runtime REST API under `<service-url>/api/v1`, bearer-token auth:

- **`/orchestrate/{agent_id}/chat/completions`** — OpenAI-compatible; drop-in for
  anything that already speaks OpenAI Chat Completions. Reply at
  `choices[0].message.content`.
- **`/orchestrate/runs`** (+ `GET /orchestrate/runs/{run_id}`) and
  **`/orchestrate/runs/stream`** — richer/async: tool-step outputs, decoding params
  (greedy / `temperature: 0`), guardrails, usage. Reply at
  `result.data.message.content[0].text`.
- **`/completions`**, **`/completions/chat`** — raw Gateway model, no agent/tools.
- **`/v2/orchestrate/{agent_id}/chat/completions`** (live-verified 2.18.0). Same OpenAI shape
  plus `data` and `context`; **no `usage`**. It is the **only path where `tool_shortlisting`
  takes effect** (§3.3a). v1 chat completions now returns `usage`.

⚠ **All of these run the agent's DRAFT by default** (live-verified 2.18.0). To serve the
deployed version, call `/orchestrate/runs` with `"environment_id": "<live env UUID>"` (from
`GET /v1/orchestrate/agents/{id}/environment`). Chat completions ignored an
`environment_id` query parameter. An app that embeds a deployed agent through chat
completions is therefore serving whatever the last `agents import` put in the draft. Plan
for that before promising "deploy = what users see".

Both agent families return a **`thread_id`** — send it back to continue a
conversation (multi-turn memory). The Python SDK `RunClient` (used by the §3.6
verification gate) is just a typed wrapper over `/orchestrate/runs`; **Python apps
use `RunClient`, non-Python apps call the HTTP endpoints directly.**

**Rule of thumb:** `chat/completions` for portability, `orchestrate/runs` for
fidelity. **Never expose the bearer token to a browser** — proxy through your
backend, which holds the token and persists `thread_id` per user session.

Full endpoint shapes, auth (local `credentials.yaml` vs SaaS IAM token), base-URL
per environment, streaming event sequences, and the app-backend proxy pattern are
in **[references/runtime-api-embedding.md](references/runtime-api-embedding.md)**.

---

## 9. Working alongside the MCP servers

There are two MCP servers for wxO. If they are installed and available, use them!
See `.bob/mcp.json` whether they are configured and not disabled.

**1. MCP Documentation Server**
Rather than guessing, utilize the MCP Documentation server!
MCP Server: `watsonx-orchestrate-adk-docs` with two tools: 
`search_ibm_watsonx_orchestrate_adk` and `query_docs_filesystem_ibm_watsonx_orchestrate_adk`. 

`search_ibm_watsonx_orchestrate_adk`:
Search across the IBM watsonx Orchestrate ADK knowledge base to find relevant 
information, code examples, API references, and guides. 

`query_docs_filesystem_ibm_watsonx_orchestrate_adk`:
Read content from pages identified by the `search_ibm_watsonx_orchestrate_adk` tool. 
This is a read-only shell-like interface to a virtualized filesystem containing only 
IBM watsonx Orchestrate documentation. 

Workflow: Start with the search_ibm_watsonx_orchestrate_adk tool for broad or 
conceptual queries. Use query_docs_filesystem_ibm_watsonx_orchestrate_adk when you 
need exact keyword/regex matching, structural exploration, or to read the full content 
of a specific page by path.

**2. MCP orchestrate ADK**
Gives Bob direct access to all commands within the watsonx Orchestrate ADK.
MCP Server: `watsonx-orchestrate-adk` with tools like `chat_with_agent`, `list_agents`, 
  `list_tools`, `list_toolkits`, `list_connections`, `list_models`, `export_agent`, 
  `get_tool_template`, `check_version`, etc. — read state from the active environment.

---

## 10. References (load on demand)

| File | Contents |
|------|----------|
| [references/cli-reference.md](references/cli-reference.md) | Every `orchestrate` group, subcommand, and flag (incl. `controls`, `workspaces`, `phone`, `skills`, premier models, traces) |
| [references/agents-tools-schemas.md](references/agents-tools-schemas.md) | Agent YAML schema (native/external/assistant, `skills:`, multi-KB, `welcome_content`, `tool_shortlisting`, `custom_agents_metadata`, the full `llm_config` field list), `@tool`/`@flow` decorators, flow nodes (5 callback events, `suppress_agent_summarization`, `page_range`, **user activities**, **agent-node `thread_control_policy`**), doc-processing with `language=`, **`output_content_types`**, **`error_handler_config`** |
| [references/connections-models-kb.md](references/connections-models-kb.md) | Connection auth schemes (incl. the `--name` custom API-key header), model providers (incl. `redhat-ai`), watsonx.ai AI Gateway, KB providers (Milvus/AstraDB/Elasticsearch) & custom RAG tools |
| [references/mcp-toolkits.md](references/mcp-toolkits.md) | Importing MCP servers as toolkits; building MCP servers for tools; the wxO MCP servers |
| [references/runtime-api-embedding.md](references/runtime-api-embedding.md) | Consuming a deployed agent from your app via the runtime REST API (`/chat/completions`, `/orchestrate/runs`, streaming, model-only completions); auth, base URLs, `thread_id` multi-turn, app-backend proxy pattern |
| [references/testing-debugging.md](references/testing-debugging.md) | Post-deploy verification gate (test before handover) + report template, **routing playbook (§2a)**, export/restore round-trip, evaluations, programmatic flow testing, failure-mode table |
| [references/agentops-evaluations.md](references/agentops-evaluations.md) | **AgentOps**: the `[agentops]` extra, the `evaluations` CLI + **what its metrics mean and which to trust**, input formats and the **keyword-matching trap**, the **three trace surfaces + full camelCase field map**, **latency triage**, **token/cost model (cost is NOT computed)**, **control-plane judge scores (async + sampled)**, and the **native-vs-derive boundary** |
| **[`watsonx-orchestrate-aaa`](../watsonx-orchestrate-aaa/SKILL.md)** *(companion skill)* | Authentication / authorization / accounting: which auth kind to choose, access-surface constraints, `member` vs `team`, RBAC and `agent_pre_invoke` plugins, identity propagation, audit trail |
| [references/setup-venv.sh](references/setup-venv.sh) | Creates virtual Python environment with `orchestrate` CLI |
| [references/wxo-chat.sh](references/wxo-chat.sh) | Tests single-turn and multi-turn conversations with agents if the MCP server `watsonx-orchestrate-adk` is not available. `--live` targets the deployed version (default = draft) |

### Canonical external resources (you have internet access — use them)
- **ADK docs:** https://developer.watson-orchestrate.ibm.com (setup, agent/tool/flow guides, YAML specs)
- **Example projects:** https://github.com/IBM/ibm-watsonx-orchestrate-adk → `examples/` (agent_builder, flow_builder, evaluations, channel-integrations, voice, plugins, **`agent-skills/`** (2.18 hello-skill with scripts/references), **`multiturn_widgets/`** (2.17), `flow_builder/user_activity_nextgen/` (2.18 activities), `flow_builder/text_extraction/` (`output_content_types`))
- **Agentic Workflow Advisor (2.17):** a companion skill that statically reviews an agentic-workflow
  JSON (+ optional agent YAML) and reports six checks by impact: sequential nodes with no data
  dependency, unmapped required I/O, LLM routing on deterministic results, input schemas over
  20 fields, toolkit nodes without HTTP calls, and replaceable agent nodes. It is built into
  Bob ("Review my agentic workflow") and lives in the ADK repo at `skills/agentic-workflow-advisor/`.
  Use it on flows before deploying; this skill covers building and operating them.
- **SDK source (ground truth for schemas):** same repo → `src/ibm_watsonx_orchestrate/`
- **Live docs MCP server** (optional): `watsonx-orchestrate-adk-docs` exposes `search_ibm_watsonx_orchestrate_adk` — see [references/mcp-toolkits.md](references/mcp-toolkits.md).

When you need a pattern this skill doesn't spell out, fetch a matching example
from the public `examples/` directory rather than inventing one.

**Always prefer live `orchestrate ... --help` over memory when a flag is in doubt.**

**Verification round 4 — 2026-10-01, ADK 2.18.0, IBM Cloud SaaS (us-south).** The skill was
three releases behind (2.15.0). A Princeton-Plainsboro hospital was built in
`test/house_hospital/` and run end to end: a `dr_house` orchestrator, five specialists
(one with 12 tools and shortlisting), an external collaborator, a scripted agent skill, a
user-activity admission flow, a doc-processing flow and a thread-aware agent-node flow
(`results/TEST_REPORT.md`). What this round *changed*, because the release notes were
incomplete or the platform disagreed:

- **Tool shortlisting only acts on v2 chat completions**: −59 % input tokens there, zero via runs/v1 (§3.3a).
- **Runs and chat completions default to the draft**; only `environment_id` on runs hits live.
  `wxo-chat.sh` gained `--live` (§3.5, §8).
- **Collaborator tool names are display-name slugs** now; the 2.13 prefix rule misses them (§3.3b).
- **Skill scripts need a `run` entry function** (§3.3c).
- **`agents export` breaks on any agent with `skills:`** (§3.3c).
- **Agent versioning is REST-only**; deleting the live version silently undeploys; `deployment_status`
  is stale (§3.3d).
- **`custom_agents_metadata`** is dropped for external agents and padded with six reserved `null`
  keys on native ones (§3.3a).
- **JWT Bearer**: PEM contents not path, RS* only, team only, eager token-URL call (§5).
- **`--iam-url`** is hidden and exists on `env add` only (§2a). **Azure auth modes** live on
  `azure-ai`, not `azure-openai` (§4). **Gemma 4** works without being in `models list` (§4).
- Reversed from 2.15: **`run.usage` is populated**; the **100-char welcome cap is gone**.

**Verification round 2 — 2026-08-05, ADK 2.13.0, IBM Cloud SaaS.** A 7-agent orchestrator +
5 specialists + an in-graph observer agent, 6 Python tools and 2 agent skills were built,
deployed and operated end to end (9 runs, 151k tokens). What that round *changed* in this
skill, because the previous text was wrong or absent:

- **`run.usage` is `null`**: the runs API does **not** carry tokens (§6a, runtime-api §4).
  *(Superseded in round 4: populated on 2.18.0.)*
  The old text listed "usage" as something `/orchestrate/runs` returns.
- **`trace.totalCost` is `0`** — tokens are native, **pricing is not** (§6a, agentops §5).
- **The AgentOps v3 field set** is now documented, including that it is **camelCase** and
  that `parentObservationId` (v3-only) is what makes latency triage possible (agentops §4).
- **The CLI trace export is a strict subset** of the v3 API — 11 fields, no `latency`,
  no span tree (cli-reference, agentops §4a).
- **Control-plane judge scores are async and sampled**, and score tool-grounded answers as
  hallucinations because tool output is out of scope (agentops §6).
- **`validate-native` keyword-matches literally** and fails semantically-correct answers;
  `Orchestrate Agent Routing F1` is the metric to trust (agentops §2).
- **The `[agentops]` extra did not require watsonx.ai credentials** on stock SaaS.
- **Routing playbook** — the orchestrator's own `instructions` are the usual cause of missed
  delegation; one sentence moved accuracy 5/9 → 8/9 (§3.3b, testing-debugging §2a).
- **Collaborator tool names append the specialty inconsistently** — match by prefix (§3.3b).
- **`load_skill` is a real runtime tool call** with a token and latency cost (§3.3c).
- **Webchat** needs `COLUMNS` widened as well as the CRN pipe, and **401s from an
  unauthenticated origin** — web chat security is a UI setting, not an ADK one (§7).
- **No ops dashboards ship** — error rate, tail latency and tool-call success are all
  customer-built (§6a).

**Verification round 3 — 2026-08-18, ADK 2.15.0, IBM Cloud SaaS (us-south).** The skill was
two releases behind (2.13.0); 2.14.0 and 2.15.0 were folded in after a live round in
`test/house_clinic/` (see its `results/TEST_REPORT.md`). Built and exercised: a
`pii_filter` **control** through full CRUD *plus an A/B proof that it enforces at runtime*
(with the control on, the PII never reaches the model — confirmed in the exported trace); a
`ppth_reference_desk` agent on **two knowledge bases**, both queried in a single turn; a
voice config carrying the new idle-handler fields, Deepgram Flux STT and
`normalize_volume`; and a document-processing **flow** with `language=` and all five flow
lifecycle callbacks. What this round *changed*, because the release notes were wrong or the
platform disagreed:

- **`welcome_message` is still capped at 100 characters**, not 1000 (API 422), §3.3.
  *(Superseded in round 4: the cap is gone on 2.18.0.)*
- The provider enums are **`redhat-ai`** and **`msftstudio`**, not `red_hat_ai` /
  `microsoft_copilot_studio` — §4.
- **`controls` has ten commands and the delete verb is `remove`**; `--config` is *not*
  schema-validated, `import` is create-only, and `export` emits display names that `import`
  cannot resolve — §4a.
- **`connections configure --name` is broken on the SaaS backend** (500, missing DB
  column) — §5.
- **Google TTS was rejected** by the platform despite a correct ADK payload — §4b.
- Voice `provider` strings are `<vendor>_stt` / `<vendor>_tts`, not the bare vendor — §4b.
- Built-in KB ingestion **rejects `.md`** — §3.3.
- docproc `classes=`/`fields=` need a pydantic **instance**, and `flow_builder.flows` must
  be imported before `flow_builder.types` — agents-tools-schemas.md.

Earlier rounds — this skill's CLI specifics were live-verified against
`ibm-watsonx-orchestrate` on a live IBM Cloud SaaS instance at **2.13.0 (2026-07-25)**, building a
**Dr. House diagnostics team** end-to-end: a `dr_house` orchestrator (`react_core` style)
with three collaborators (`dr_wilson`/`dr_foreman`/`dr_cuddy`), a `differential_diagnosis`
tool, and a **`diagnostics-protocol` agent skill** (import → attach via `skills:` → export
round-trip). Verified live: single-turn tool call, multi-turn context + `chat_with_collaborator_*`
delegation, and the reworked **observability traces** (`search --last`, observations export).
Evidence in the `test/` folder (`test/results/TEST_REPORT.md`,
`test/verification/FEATURE_VERIFICATION_2.13.0.md`). Also verified at 2.12.0: a `house_triage`
**flow** (parallel + decision + masking) and an **AgentOps** `validate-native` run. The flow
`decisions` table, the extended callbacks (`ON_FLOW_ABORT`/`ON_FLOW_DELETE`),
`suppress_agent_summarization`, doc-extractor `page_range`, timer, and voice Flux are
source-/release-notes-verified (not yet exercised in a live run).