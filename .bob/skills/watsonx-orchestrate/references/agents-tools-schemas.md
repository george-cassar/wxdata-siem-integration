# Agents, Tools & Flows — schemas and decorators

Grounded in the ADK source (`agent_builder/agents/types.py`,
`agent_builder/tools/python_tool.py`, `flow_builder`).

---

## 1. Agent YAML — `kind: native`

```yaml
spec_version: v1                 # REQUIRED
kind: native                     # REQUIRED
name: my_agent                   # REQUIRED — snake_case, no spaces
description: What this agent does and when to use it.   # REQUIRED (used for routing)
display_name: My Agent           # optional, UI label
instructions: |                  # the system prompt / behavior
  You are ... When the user ..., call <tool>. Be concise.
llm: watsonx/meta-llama/llama-3-3-70b-instruct   # defaults to tenant default if omitted
llm_config:                      # optional (2.11+) — per-agent decoding params. Full field
  temperature: 0                 #   list below; anything you omit round-trips back as null.
  max_tokens: 2048
style: react_core                # 2.13.0: react_core is the DEFAULT. `default`, `react`, `planner` are
                                 #   DEPRECATED (still import but log a warning → migrate to react_core:
                                 #   https://www.ibm.com/docs/SSAVQO/agent_builder/agent-style-migration.html).
                                 #   Source also exposes react_intrinsic | custom | experimental_customer_care.
hide_reasoning: false
tools:                           # by name; must be imported first
  - get_weather
skills:                          # 2.13.0 — portable agent skills, by name (KEBAB-CASE, e.g. my-skill).
  - diagnostics-protocol         #   Import first with `orchestrate skills import`. Round-trips on export.
collaborators:                   # ORCHESTRATOR pattern: other agents used as agents (by name).
  - billing_agent               #   Import/deploy them FIRST. wxO auto-generates a
                                #   chat_with_collaborator_<name> tool; routing is driven by
                                #   each collaborator's `description`. See SKILL §3.3b. Not for
                                #   experimental_customer_care style. (live-verified 2.13.0)
knowledge_base:                  # curated RAG corpora (KB names), ingested by you — distinct
  - product_docs                #   from chat_with_docs (end-user uploads docs in-chat).
  - support_policies            #   2.15.0: MULTIPLE KBs are allowed. Each becomes its OWN
                                #   retrieval tool named after the KB, and the router picks
                                #   between them from each KB's `description` — so write those
                                #   as mutually-exclusive routing triggers. (live-verified 2.15.0:
                                #   one question hit both, step_history showed two tool calls.)
toolkits: []                     # only for experimental_customer_care style
guidelines:                      # optional conditional behaviors
  - display_name: Escalate
    condition: user asks for a human
    action: hand off to billing_agent
    tool: billing_agent
structured_output:               # optional JSON schema to force structured replies
  type: object
  properties:
    answer: { type: string }
custom_join_tool: null           # planner style only (mutually exclusive w/ structured_output)
context_access_enabled: true
context_variables: []            # ⚠ NOT just "a list of strings" — this is the ALLOWLIST
                                 #   controlling which context fields are injected into
                                 #   your tools at runtime, and it is EXCLUSIVE: it filters
                                 #   the platform's own keys too. Leave it empty and tools
                                 #   see only wxo_run_id/wxo_tenant_id/wxo_thread_id/
                                 #   wxo_user_name. List [roles, email] and those four
                                 #   DISAPPEAR unless you list them as well. Callers supply
                                 #   values via `context` (or `context_variables`) in the
                                 #   /v1/orchestrate/runs body. (live-verified 2.15.0)
                                 #   → identity, RBAC and audit implications: the
                                 #     `watsonx-orchestrate-aaa` companion skill §2.4
memory_enabled: null             # agentic memory (retain history/context across a session)
is_schedulable: null             # 2.11+ — true enables recurring runs; internal scheduling
                                 #   tools auto-appear (and are visible/deletable via ADK CLI — known issue)
restrictions: null               # 2.11+ — access restrictions
compaction_settings:             # 2.11+ — conversation compaction (prevents context overflow)
  context_compaction_enabled: true
  context_compaction_threshold: 20000   # tokens triggering Level-1 compaction
  compaction_sliding_window: 10         # recent messages kept verbatim
  large_message_threshold: 50000        # token size marking a "large" message
  large_message_chunk_size: 30000
  large_message_target_summary: 10000
  large_message_detect_structured: true
tool_shortlisting:               # 2.18.0 — narrow the toolset before planning (retrieval step)
  enabled: true                  #   omit either field → the style's default; max_tools > 0
  max_tools: 5                   #   ⚠ ONLY acts on /v2/orchestrate/{id}/chat/completions — no
                                 #   effect via /orchestrate/runs or v1 (live-verified 2.18.0,
                                 #   708 → 288 input tokens on v2; unchanged on runs/v1)
custom_agents_metadata:          # 2.17.0 — free-form key/value labels (any agent kind on paper)
  team: diagnostics              #   ⚠ native: server adds 6 reserved null keys (language,
                                 #   framework, tool_count, tool_names, tool_parameters,
                                 #   connection_requirements); external: DROPPED server-side
                                 #   (live-verified 2.18.0). CLI: --custom-agents-metadata '{…}'
starter_prompts:           # ⚠ valid fields ONLY: id, title, subtitle, prompt
  prompts:                 #   DO NOT add `is_default_prompts:` or per-prompt `state:` —
    - id: default0         #   both are silently ignored and cause tiles not to render in
      title: Short action title   #   the UI. (live-verified 2.12.0 — confirmed via export
      subtitle: optional          #   round-trip and UI regression)
      prompt: Example clickable prompt
welcome_content:
  welcome_message: Welcome to My Agent   # 2.18.0: a 164-char message was stored intact, so
                                         #   the 100-char cap that 2.15.0 still enforced (422)
                                         #   is gone. Keep ≤100 only for older tenants.
  description: One line on what it helps with   # put the long text here instead
  is_default_message: false
  is_user_barge_in_disabled: false  # 2.15.0 — true = user cannot interrupt the agent's
                                    #   spoken opening message (voice). Round-trips on export.
chat_with_docs:                  # let END USERS upload documents in-chat and ask over them
  enabled: true                  #   (RAG over user-uploaded files — no pre-ingestion). The
  supports_full_document: true   #   full block (seen on export) carries vector_index
  # vector_index: { chunk_size: 400, chunk_overlap: 50, limit: 10, extraction_strategy: express }
  # generation: { max_docs_passed_to_llm: 5, generated_response_length: Moderate, ... }
  # query_rewrite: { enabled: true }, citations: { ... }, hap_filtering: { ... }
  # → use `enabled: true` to switch on; the rest default sensibly. Distinct from
  #   `knowledge_base:` (curated corpora you ingest). Not for experimental_customer_care.
  # ⚠ RUNTIME (live-verified 2.12.0 SaaS): chat_with_docs ingestion is wired for the
  #   chat UI / embedded web-chat upload widget. Driving it through the runtime
  #   /v1/orchestrate/runs API did NOT make the agent read the uploaded file (even via
  #   the ADK's create_run_with_files) — the doc uploads to S3 but isn't ingested. For
  #   PROGRAMMATIC document RAG, use `knowledge_base:` instead; use chat_with_docs for
  #   interactive end-user uploads via a channel. (ADK RunClient.upload_file_to_s3 also
  #   has a SaaS bug: it POSTs to /v1/upload-to-s3/ → 404; correct is
  #   /v1/orchestrate/upload-to-s3 with NO trailing slash → 200.)
icon: null
is_schedulable: null
```

**Full `llm_config` field list** (from a 2.15.0 export round-trip — everything unset comes
back as `null`, so this is the complete accepted set):
`model`, `decoding_method`, `prompt`, `max_tokens`, `max_completion_tokens`, `temperature`,
`top_p`, `top_k`, `n`, `stream`, `logprobs`, `top_logprobs`, `echo`, `stop`,
`presence_penalty`, `frequency_penalty`, `best_of`, `logit_bias`, `user`, `context`,
`examples`, `response_format`, `seed`, `store`, `metadata`, `modalities`, `audio`,
`service_tier`, `prediction`, `safety_settings`, `anthropic_beta`, `anthropic_version`,
`thinking`, `space_id`, `project_id`, `reasoning_effort`, `parallel_tool_calls`,
`disable_parallel_tool_use`, `disable_tool_validation`, `verbosity`, `thinking_level`.

**Validation rules from source**
- `kind` must equal `native` for a native agent (else `BadRequest`).
- An agent cannot list itself as a collaborator (circular reference).
- `style` default is `react_core` (2.13.0); `default`/`react`/`planner` are deprecated and
  log a warning on import (`_raise_style_deprecation_warning`).
- `planner` style (deprecated): provide at most one of `custom_join_tool` / `structured_output`.
- `experimental_customer_care` style: expects `groq/openai/gpt-oss-120b`; does
  **not** support `tools`, `knowledge_base`, `plugins`, `guidelines`,
  `collaborators`, `custom_join_tool`, `chat_with_docs.enabled`.
- `toolkits` are rejected for non-customer-care styles (except the schedulable
  `scheduling_tools` exception).

### External agent (`kind: external`)
A2A / external chat agents. Key fields: `api_url` (required), `auth_scheme`
(`BEARER_TOKEN | API_KEY | NONE`), `auth_config`, `provider`
(the `AgentProvider` enum, 2.15.0: `external_chat`, `external_chat/A2A/0.2.1`,
`external_chat/A2A/0.3.0`, `wx.ai`, `watsonx`, `salesforce`, and **`msftstudio`** for
Microsoft Copilot Studio — the 2.14 release note calls the last one
`microsoft_copilot_studio`, which is **not** the enum value), `nickname`,
`app_id`/`connection_id`, `chat_params`,
`config.enable_cot`, `config.hidden`, `tags`. Import with `orchestrate agents import -f … --app-id <conn>`.

**As a collaborator (2.17.0, import-verified 2.18.0):** list the external agent's `name` under a
native agent's `collaborators:`; import the external agent first. **`custom_agents_metadata` is
not stored for external agents** on 2.18.0 SaaS, so use `tags:` for labels. Export shows
`api_url: <hidden>`.

### Assistant agent (`kind: assistant`)
Wraps a watsonx Assistant. `config` carries `assistant_id`, `crn`,
`service_instance_url`, `environment_id`, `auth_type`
(`MCSP | IBM_CLOUD_IAM | ICP_IAM | BEARER_TOKEN`), `api_key`, `authorization_url`,
`connection_id`; plus top-level `nickname`, `app_id`.

### Defining an agent in Python (alternative to YAML)
```python
from ibm_watsonx_orchestrate.agent_builder.agents import Agent
agent = Agent(
    name="my_agent",
    description="...",
    instructions="...",
    llm="watsonx/meta-llama/llama-3-3-70b-instruct",
    tools=[get_weather],          # PythonTool objects or names
)
agent.dump_spec("agents/my_agent.yaml")   # serialize for CLI import
```

---

## 2. Python tools — `@tool`

```python
from ibm_watsonx_orchestrate.agent_builder.tools import tool, ToolPermission
```

Decorator signature (all optional):
```python
@tool(
    name=...,                 # defaults to function name
    description=...,          # defaults to docstring summary (used for routing)
    permission=ToolPermission.READ_ONLY,   # READ_ONLY | WRITE_ONLY | READ_WRITE | ADMIN
    expected_credentials=[...],             # list[ExpectedCredentials]
    display_name=...,
    input_schema=..., output_schema=...,    # ToolRequestBody/ResponseBody (advanced)
    enable_dynamic_input_schema=False, enable_dynamic_output_schema=False,
    response_format=...,                     # 'content' | 'content_and_artifact'
)
```

### Google-style docstring (parser is strict)
```python
@tool(permission=ToolPermission.READ_WRITE)
def process_request(request_id: str, user_email: str, priority: str = "normal") -> dict:
    """
    Process a service request and create a ticket.

    Args:
        request_id (str): Unique identifier for the request.
        user_email (str): Email of the requesting user.
        priority (str): Priority level (default: normal).
    Returns:
        dict: Result with status and message.
    """
    ...
```
- Summary line, then `Args:`, then `Returns:` with **no blank line between the
  Args and Returns blocks**.
- Every param + return value needs a type hint that matches the docstring type.
- Missing type hints → the parser warns and defaults to `str`.

### Credentials at runtime (never as parameters)
```python
from ibm_watsonx_orchestrate.agent_builder.tools import tool, ToolPermission
from ibm_watsonx_orchestrate.agent_builder.connections import ConnectionType, ExpectedCredentials
from ibm_watsonx_orchestrate.run import connections

APP_ID = "my_api"

@tool(permission=ToolPermission.READ_ONLY,
      expected_credentials=[ExpectedCredentials(app_id=APP_ID, type=ConnectionType.API_KEY_AUTH)])
def call_api(query: str) -> dict:
    """Call the API.

    Args:
        query (str): Search text.
    Returns:
        dict: API response.
    """
    conn = connections.api_key_auth(APP_ID)     # fetch at runtime
    headers = {"Authorization": f"Bearer {conn.api_key}"}
    ...
```
Runtime accessors: `connections.api_key_auth(app_id).api_key`,
`connections.basic(app_id).username/.password`,
`connections.bearer_token(app_id).token`,
`connections.oauth2_auth_code(app_id).access_token`.

### Self-containment
Only stdlib, common third-party (`requests`, `pydantic`, …), and
`ibm_watsonx_orchestrate` imports. **No** `from .x import y` or
`from tools.shared import z`. Define every helper/Pydantic model in the same file.

### Pydantic schemas
Define as explicit classes — never `type('X',(BaseModel,),{...})` (causes
"non-annotated attribute" errors):
```python
from pydantic import BaseModel, Field
class Result(BaseModel):
    status: str = Field(description="Outcome status")
```

---

## 3. Flows — `@flow`

```python
from pydantic import BaseModel
from ibm_watsonx_orchestrate.flow_builder.flows import Flow, flow, START, END

class MyInput(BaseModel):
    city: str

@flow(name="weather_flow", display_name="Weather Flow",
      description="Fetch then format weather", input_schema=MyInput)
def build_weather_flow(aflow: Flow) -> Flow:        # signature is mandatory
    fetch = aflow.tool(get_weather)
    summarize = aflow.prompt(
        name="summarize",
        system_prompt="You format weather data for users.",   # REQUIRED
        user_prompt=["Summarize: {weather}"],
        llm="watsonx/meta-llama/llama-3-3-70b-instruct",
    )
    aflow.sequence(START, fetch, summarize, END)
    return aflow
```

**Node builders** (2.18.0 `Flow` methods): `aflow.tool(fn)`, `aflow.prompt(...)`,
`aflow.script(...)`, `aflow.agent(...)`, `aflow.docproc(...)`, `aflow.docext(...)`,
`aflow.docclassifier(...)`, `aflow.decisions(...)`, `aflow.timer(...)`, `aflow.userflow(...)`
(user activities live inside it), `aflow.branch(...)`/`aflow.conditions(...)`,
`aflow.parallel(...)`/`aflow.parallel_conditions(...)`, `aflow.foreach(...)`, `aflow.loop(...)`. **Wiring**: `aflow.sequence(START, n1, n2, END)` or
`aflow.edge(a, b)`. **Data**: `node.map_input(...)`, `aflow.map_output(...)`.

**New in 2.11–2.12 — flow-builder API (live-verified against ADK 2.12.0 source +
a compiled/imported flow on IBM Cloud SaaS, 2026-06-29):**

Expression syntax everywhere is `flow.input.<field>` / `flow.<var>` (paths must start
with `flow.` and have ≥3 parts). Map a node input with
`node.map_input("<param>", "flow.input.<field>")`.

- **Parallel branches** — `p = aflow.parallel_conditions(name="gather")` (all branches
  run) or `aflow.parallel(evaluator=Conditions(...), ...)`. **Create branch nodes ON
  the parallel node** (`n = p.tool(fn)` / `p.prompt(...)` / `p.sequence(...)`), then
  wire each: `p.condition(to_node=n, default=True)` (always run) or
  `p.condition(expression="flow.input.x=='hi'", to_node=n)`. Parallel runs **all**
  matching conditions concurrently (unlike a branch, which takes the first match).
  `foreach(item_schema=...)` similarly supports a parallel mode.
- **Decision / if-else** — `b = aflow.conditions(name="route")` (empty evaluator) or
  `aflow.branch(name=, evaluator=Conditions([...]) | "expr")`; wire with
  `b.condition(expression="flow.input.severity=='high'", to_node=urgent)` and
  `b.condition(default=True, to_node=routine)`. First match wins.
- **Decision table** — `aflow.decisions(name=, rules=[DecisionsRule(conditions=[...],
  actions={...})], default_actions=...)` for compact rule→action tables.
- **Callbacks** — `aflow.add_callback(tool="<tool_name>", events=[...], batch_interval=None)`.
  Events (`FlowCallbackEventKind`) — **8 kinds, re-confirmed at 2.15.0**: `ON_FLOW_START`, `ON_FLOW_END`,
  `ON_FLOW_ERROR`, **`ON_FLOW_ABORT`** *(new)*, **`ON_FLOW_DELETE`** *(new)*, `ON_TASK_WAIT`,
  `ON_TASK_ERROR`, `ON_TASK_MESSAGE`. Callback tools now receive a structured
  **`FlowCallbackEventsPayload`** (`events: [...]`); an `ON_TASK_WAIT` event carries an
  `elicitation` block (mode / message / elicitationId / requestedSchema / meta) so external
  systems and MCP clients can respond to a waiting task **without polling**.
- **Suppress agent summarization (2.13.0)** — `@flow(..., suppress_agent_summarization=True)`
  (or `aflow.suppress_agent_summarization(True)`) stops the agent from re-summarizing the flow
  result in chat after the workflow ends (avoids duplicate output). **Default is `True`** in the
  `@flow` decorator — pass `False` to keep the post-flow agent summary.
- **Data masking** — `aflow.mask_property(property_path="flow.input.symptoms",
  masking_policy=MaskingPolicy.MASK_ALL)`. Policies: `MASK_ALL`, `MASK_FIRST4`,
  `MASK_LAST4`, `MASK_VIA_REGEX` (pass `regex_config=` for the last). Masked in chat,
  flow inspector, and traces.
- **Timer / scheduling** — `aflow.timer(name=, delay=<seconds:int>, ...)`.
- **Multi-language** — `translation_enabled`, `source_locale`, `target_locales` on the flow.
- ⚠ **Not implemented in 2.12** (raise `ValueError` at build): `aflow.wait_for(...)`;
  `branch(evaluator=<function>)`; Branch `MatchPolicy.ANY_MATCH`. Avoid these.
- ⚠ Platform known issues: parallel branches **pause on user interaction**; multi-step
  user activities running in parallel can break chat prompts.

**New in 2.16 → 2.18 (live-verified 2.18.0 on SaaS):**

- **Agent node threading (2.16)**: `aflow.agent(name, agent, title=, message=, description=,
  input_schema=, output_schema=, guidelines=, thread_control_policy=)`.
  `thread_control_policy: Literal["REUSE_AND_CORRELATE", "CREATE_ALWAYS"]`.
  `REUSE_AND_CORRELATE` (default) reuses the correlated thread across invocations;
  `CREATE_ALWAYS` gives every invocation an isolated thread. Omitting it logs
  `No valid thread_control_policy specified … Defaulting to 'REUSE_AND_CORRELATE'`. Any other
  value raises `ValueError`. Both values are stored in the exported spec and ran correctly.
  The agent must already be imported.
- **User activity nodes (2.18)**: a single-widget interaction inside a userflow
  (`spec_version 2.0`):
  ```python
  uf = aflow.userflow(display_name="Admission", label="Admitting {flow.input.patient_name}")
  a = uf.activity(name="consent", display_name="Consent", description=None)
  a.boolean_input_field(name="ok", label="Consent", agent_message="Does {flow.input.patient_name} consent?",
                        true_label="Yes", false_label="No", required=True)
  ```
  Widget methods on an activity: `text_input_field(name, label, agent_message, required,
  single_line, placeholder_text, help_text, default, regex, regex_error_message)`,
  `boolean_input_field(…, single_checkbox, true_label, false_label)`, `number_input_field`,
  `date_input_field`, `datetime_input_field`, `file_upload_field` (supported in source but
  missing from the release note), and `message_output_field(name, text=…)` (on an activity,
  `label` is ignored and `text`/`message` becomes the output). **Exactly one widget per
  activity**; a second call raises `ValueError` ("A UserActivity holds a single widget").
  Other `form()` widgets (choice, list, …) raise as well, so use `uf.form(...)` for those.
  **Runtime shape:** each activity is a thread message with `response_type:
  "multiturn_form"`, a `json_schema` (`title` = `label`, `description` = substituted
  `agent_message`), a `ui_schema`, and `activity_info.{action_status, activity_title}`.
  `activity_title` is the userflow's `display_name`, **not** its `label`. A plain-text user reply
  on the thread answers the pending activity. Output widgets arrive as an already-`completed`
  form with `form_data` filled.
- **Doc-processing (2.16 → 2.18)**:
  - `aflow.docproc(..., output_content_types=[OutputContentType.text|markdown|html, …])`
    (2.18). The response (`TextExtractionResponse` / `TextExtractionObjectResponse`) carries
    `text`, `markdown`, `html`, each present only if requested. `None` defaults to `["text"]`;
    **`[]` skips text extraction** (KVP-only). `DocProcInput.output_content_types` is a runtime
    override. Pair it with `output_format=DocProcOutputFormat.object` to get inline fields.
  - `aflow.docclassifier(..., page_range=PageRange(start=1, end=2))` (2.18) classifies from
    that page range only.
  - `error_handler_config=NodeErrorHandlerConfig(error_message=, max_retries=,
    retry_interval=, on_error="show_message"|"branch", error_edge_id=)` on `docproc`,
    `docext` and `docclassifier` (2.16).
  - Classifier and field extractor are **GA** (2.16).
  - Verified: all of the above are stored in the exported flow JSON (`tools export -n <flow>
    -o x.zip`). Running them needs an uploaded document, so they were not executed here.

For a complete, compiling reference flow (parallel + decision + masking + prompts), see the
public `examples/flow_builder/` directory in the ADK repo
(https://github.com/IBM/ibm-watsonx-orchestrate-adk/tree/main/examples/flow_builder).

Constraints:
- Function name starts with `build_`, param is `aflow: Flow`, returns `Flow`.
- One flow per file.
- `map_input`/`map_output` expressions are **single-line** Python (list
  comprehensions/inline logic only) — no defining or calling functions; flow-file
  functions are not available at runtime.
- `prompt` nodes require `system_prompt`.

Import a flow as a tool: `orchestrate tools import -k flow -f tools/weather_flow.py`.

### Document processing (docproc) — KVP extraction
Use `DocProcKVPSchema` + `DocProcField` (not plain dicts):
```python
from ibm_watsonx_orchestrate.flow_builder.types import (
    DocProcInput, DocProcKVPSchema, DocProcField, DocProcOutputFormat)

SCHEMA = DocProcKVPSchema(
    document_type="Invoice", document_description="A business invoice",
    additional_prompt_instructions="Extract values exactly as shown.",
    fields={"invoice_number": DocProcField(description="Invoice id", default="", example="INV-001")},
)

@flow(name="doc_flow", input_schema=DocProcInput)
def build_doc_flow(aflow: Flow) -> Flow:
    node = aflow.docproc(name="extract", task="text_extraction",
                         output_format=DocProcOutputFormat.object,
                         kvp_schemas=[SCHEMA], kvp_force_schema_name="Invoice")
    aflow.sequence(START, node, END)
    return aflow
```
With `output_format=object`, `kvps` is a **list** of objects shaped like
`{"key": {"semantic_label": "invoice_number"}, "value": {"raw_text": "INV-001"}}`.
To use values, either pass the whole `kvps` array to a `prompt` node to format,
or extract with a single-line list comprehension matching `semantic_label`.
**Agents cannot pass user-uploaded files to a flow** — the docproc node prompts
the user for the upload itself; agent instructions should just invoke the flow.

**docproc / doc-extractor updates (2.14.0–2.15.0, verified against 2.15.0 source; the flow
below imported successfully live):**
- **`language=` on every document-processing node** — `docproc`, `docext` and
  `docclassifier` all take `language: LanguageCode | None`, an **ISO-639** code
  (`LanguageCode.en`, `.fr`, `.de`, …). Defaults to English when omitted. There is also a
  runtime override: `DocProcInput.language` overrides whatever the node spec carries.
  Handwritten variants exist only for English and German.
- **Classifier class cap** — `DocClassifierConfig.classes` is `max_length=30`. Exceeding it
  fails at authoring time, not at run time.
- **Default node LLM is now `watsonx/openai/gpt-oss-120b`** on the `docclassifier`/`docext`/
  `docproc` builder signatures (`DocExtConfig`'s own default is still
  `watsonx/mistralai/mistral-small-3-1-24b-instruct-2503` — the builder argument wins).

⚠ **Two traps that cost real time when authoring a docproc flow (live-verified 2.15.0):**

1. **`classes=` / `fields=` want a pydantic model INSTANCE, not the class.** The signatures
   are type-hinted `type[BaseModel]`, but the builder calls **both**
   `container.__dict__.values()` *and* `container.model_dump()` on the argument — which only
   works on an instance. Passing the class (or a plain class, or a `SimpleNamespace`) fails
   with a wall of `Input should be a valid dictionary or instance of DocClassifierClass`
   errors naming `__module__` / `__weakref__`.

   ```python
   class ReferralFields(BaseModel):
       patient_name: DocExtConfigField = DocExtConfigField(
           name="patient_name", type="string", description="Patient's full name")
       referring_physician: DocExtConfigField = DocExtConfigField(
           name="referring_physician", type="string", description="Signing physician")

   node, schema = aflow.docext(name="extract", fields=ReferralFields(),   # ← INSTANCE
                               language=LanguageCode.en,
                               field_extraction_method="layout",
                               page_range=PageRange(start=1, end=2))
   ```

2. **Import `flow_builder.flows` BEFORE `flow_builder.types`.** Importing types first raises
   `ImportError: cannot import name 'FlowContext' … (most likely due to a circular import)`.

**docproc / doc-extractor updates (2.13.0 verified in source):**
- **Page-range extraction** — both the document **text** extractor (`docproc`) and the
  document **field** extractor (`docext`) take a **`page_range`** parameter, a
  `PageRange(start=<int>, end=<int>)` (1-based, inclusive) that limits extraction to those
  pages — useful for large files where only some pages matter. ⚠ On the **field** extractor,
  `page_range` is **only supported when `field_extraction_method='layout'`** (a validator
  rejects it otherwise).
- **Default extractor model is `mistral-small`** (`watsonx/mistralai/mistral-small-3-1-24b-instruct-2503`);
  AI-Gateway models can be used for KVP extraction.
- **Structured (vision) vs Unstructured (text)** extractors: use structured/vision for
  forms and tables, unstructured/text for text-heavy documents.

### Programmatic flow test
```python
import asyncio
from pathlib import Path
from tools.weather_flow import build_weather_flow

async def main():
    fdef = await build_weather_flow().compile_deploy()
    fdef.dump_spec(f"{Path(__file__).parent}/generated/weather_flow.json")
    await fdef.invoke({"city": "Paris"}, debug=True)

asyncio.run(main())
```
Run with `PYTHONPATH` pointing at the ADK `src` if importing ADK internals.
