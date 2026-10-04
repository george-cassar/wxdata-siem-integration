# `orchestrate` CLI reference

Verified against **`ibm-watsonx-orchestrate` 2.18.0** (groups/commands confirmed live on
IBM Cloud SaaS, 2026-10-01; original catalog from 2.10.0). The CLI evolves — **always
confirm with `orchestrate <group> --help` and `orchestrate <group> <cmd> --help`**. Short
flags are shown in `()`.

Top-level groups (unchanged 2.15.0 → 2.18.0, from `orchestrate --help`):
`env`, `agents`, `tools`, **`skills`**, `toolkits`, `knowledge-bases`, `connections`,
`voice-configs`, `server`, `chat`, `models`, `channels`, `phone`, `evaluations`,
`settings`, `partners`, `observability`, **`controls`**, `workspaces`.

> Note the plural **`toolkits`** and **`voice-configs`** group names. **`controls` is new in
> 2.15.0.** `agents list` also gains **Skills** and **Plugins** columns; `env activate`
> now also prints the **active workspace** (`Active workspace: Global workspace`).

> **2.16 → 2.18 additions (live-verified 2.18.0 unless noted):**
> - **No new top-level groups.** Agent versioning (2.17) has **no CLI verbs** beyond
>   `agents deploy`/`undeploy`. List/switch/delete versions through the REST releases API
>   (SKILL.md §3.3d).
> - `agents create --custom-agents-metadata '{"k":"v"}'` (2.17). It is stored for native agents
>   only; the server drops it for external ones.
> - `connections configure -k oauth_auth_jwt_bearer_flow` (2.16, **`-t team` only**) plus new
>   `set-credentials` flags `--alg`, `--private-key` (**PEM contents**), `--kid`,
>   `--private-key-password`, `--iss`, `--aud`, `--exp`, `--include-jti/--no-include-jti`,
>   `--claims k=v` (repeatable).
> - `env add --iam-url(-i)` (2.16) for HIPAA / MCSP V2. It is **hidden** from `--help` and **not**
>   on `env activate`, despite the release note. `--type` gains **`k8s`** (EKS, 2.16).
> - `skills import -d <dir>` now uploads `scripts/` and `references/` too and reports the counts
>   (2.18 hello-world pattern); `skills export` writes SKILL.md, a generated `WXO.yaml`
>   (`scripts:` list), scripts and references.
> - ⚠ `agents export` **fails for any agent with `skills:`** on 2.18.0
>   (`No skill found with the id '<name>'`).
> - `knowledge-bases export --help` text fixed (2.18). The custom-agent config summary now lists
>   Python requirements (2.18, not tested).
>
> **2.15.0 additions (live-verified):**
> - **`controls` group** — bind policy artifacts to agents/tools/models. Ten commands
>   (the release note lists five, and calls `remove` "delete"). Full section below.
> - **`connections configure --name`** — custom API-key header name; `api_key` kind only.
> - Agents may reference **multiple knowledge bases**; each becomes its own retrieval tool.
> - **`welcome_content.is_user_barge_in_disabled`**, voice `user_idle_handler`
>   `use_llm_generated_idle_message` / `repeat_previous_message`, and
>   `agent_idle_handler.long_running_task_seconds`.
> - Deepgram **`flux-general-en` / `flux-general-multi`** STT models no longer raise a
>   spurious validation warning.
>
> **2.14.0 additions:**
> - `language=` on every document-processing node; classifier hard-capped at **30 classes**.
> - Google TTS (`google_tts_config`) and Deepgram `normalize_volume`.
> - Flow lifecycle events **`on_flow_abort`**, **`on_flow_delete`**.
> - KB credential validation at create/update time; `index_config.url` now **optional**
>   (it may come from the connection instead).
> - Model provider **`redhat-ai`**; external-agent provider **`msftstudio`**.
> - Langflow → 1.10.0 (the 2.15.0 CLI reports **Langflow 1.11.2** in `orchestrate --version`).
>
> **2.13.0 additions (live-verified):**
> - **`skills` group** — manage agent skills (`SKILL.md` packages). See the skills section below.
> - **Agent `style` default is `react_core`**; `default`/`react`/`planner` deprecated.
> - **Premier models** — `models config enable-premier-models` / `disable-premier-models` /
>   `are-premier-models-enabled` (GPT-5.4 etc.).
> - **Observability traces** reworked — `search --last`, `--user-id`/`--session-id`;
>   agent/service/span filters deprecated; `export` returns *observations* (see below).
>
> **2.11–2.12 additions (from release notes, confirm with `--help`):**
> - **Scheduling:** agents/flows support recurring runs via `is_schedulable` in YAML
>   (internal scheduling tools then auto-appear); schedules themselves are created
>   conversationally in chat, not via a dedicated CLI verb.
> - **Custom / LangGraph agents (GA):** create and import custom agents from files
>   via `agents create` / `agents import`, including **mapping connections during
>   import from a ZIP** (look for a config/experimental-config flag on `agents
>   import --help`). LangGraph agents gained checkpointing + context variables.
> - **Compaction & per-agent decoding:** new `compaction_settings` / `llm_config`
>   YAML blocks (see agents-tools-schemas.md) — set in YAML, imported as usual.
> - **MCP toolkit export** and **dynamic KB schemas** were added around 2.10.
> - **Voice:** Deepgram **Flux** models (Flux General English is the new default,
>   Flux Multilingual, Nova-3 Medical) selectable in `voice-configs`.

---

## env — environments

| Command | Key options |
|---------|-------------|
| `env list` | — |
| `env add` | `--name(-n)`, `--url(-u)`, `--type(-t)` `[ibm_iam\|mcsp\|mcsp_v1\|mcsp_v2\|cpd\|k8s]`, `--iam-url(-i)` *(hidden from `--help`)*, `--activate(-a)`, `--insecure`, `--verify` |
| `env activate <name>` | *(name is positional)* `--api-key(-a)` (WXO/CPD; blank for local), `--username(-u)` (CPD), `--password(-p)` (CPD), `--skip-version-check`/`--enable-version-check` |
| `env remove` | `--name(-n)` |

```bash
orchestrate env list
orchestrate env activate local
orchestrate env add -n prod -u https://api.us-south.watson-orchestrate.cloud.ibm.com/instances/XXXX
orchestrate env activate prod --api-key "$IBM_CLOUD_API_KEY"
orchestrate env remove --name prod
```

Local CLI config lives at `~/.config/orchestrate/config.yaml` (shows
`context.active_environment` and per-env `wxo_url`/`auth_type`).

---

## agents

| Command | Key options |
|---------|-------------|
| `agents import` | `--file(-f)`, `--app-id(-a)` (external agents), `--safe` |
| `agents create` | `--name(-n)`, `--kind(-k)`, `--description`, `--llm`, `--style`, `--instructions`, `--tools`, `--collaborators`, `--knowledge-bases`, `--output(-o)`, external: `--title(-t)`, `--api(-a)`, `--auth-scheme`, `--provider(-p)`, `--auth-config`, `--tags`, `--chat-params`, `--config`, `--nickname`, `--app-id`, `--context-access-enabled`, `--context-variable(-v)`, **`--custom-agents-metadata`** (JSON dict, 2.17), custom agents: `--package-root`, `--config-file`, `--file(-f)` (ZIP) |
| `agents list` | `--kind(-k)`, `--verbose(-v)` |
| `agents export` | `--name(-n)`, `--kind(-k)`, `--output(-o)`, `--agent-only` — ⚠ `--agent-only` requires a **`.yaml`** output; without it (full dependency bundle) the output must be **`.zip`**. Each rejects the other extension. |
| `agents deploy` | `--name(-n)` — releases the draft as a **new version** and points `live` at it |
| `agents undeploy` | `--name(-n)` |
| *(versions)* | **No CLI verbs.** REST: `GET/POST /v1/orchestrate/agents/{id}/releases`, `POST …/releases/{v}/environment/{env_id}` (switch), `POST …/releases/{v}/undeploy`, `DELETE …/releases/{v}` (SKILL.md §3.3d) |
| `agents connect` | add application connections to a custom agent |
| `agents remove` | `--name(-n)`, `--kind(-k)` |
| `agents copy` | `--name(-n)`, `--destination(-d)`, `--source(-s)` |
| `agents discover` | A2A discovery: `--url(-u)`, `--endpoint(-e)` (default `.well-known/agent-card.json`), `--name(-n)`, `--app-id(-a)` |
| `agents ai-builder` | AI-assisted agent builder |

```bash
orchestrate agents import -f agents/weather_agent.yaml
orchestrate agents list -k native -v
orchestrate agents export -n weather_agent -k native -o weather_agent.yaml --agent-only
orchestrate agents deploy -n weather_agent
```

`--kind` is `native | external | assistant`.

---

## tools

| Command | Key options |
|---------|-------------|
| `tools import` | `--kind(-k) python\|openapi\|flow\|langflow`, `--file(-f)`, `--requirements-file(-r)`, `--package-root(-p)`, `--app-id(-a)` (repeatable), `--name(-n)`, `--auto-discover`, `--llm`, `--env-file`, `--function`, `--save-flow-json`, `--safe` |
| `tools list` | `--verbose(-v)` |
| `tools export` | `--name(-n)`, `--output(-o)` |
| `tools remove` | `--name(-n)` |

```bash
orchestrate tools import -k python -f tools/weather.py -r tools/requirements.txt
orchestrate tools import -k python -f tools/api_tool.py --app-id my_api
orchestrate tools import -k openapi -f specs/petstore.yaml
orchestrate tools import -k flow -f tools/my_flow.py
```

- `--package-root(-p)` when a python tool spans multiple files in a package dir.
- `--auto-discover` (python only) generates docstrings/tools via an LLM (`--llm`, `--env-file`, `--function`).

---

## skills — agent skills (NEW in 2.13.0)

Portable, version-controlled `SKILL.md` packages (optional sibling `WXO.yaml` is sent
automatically). Attach to an agent via the YAML `skills:` field. **Skill `name` must be
kebab-case** (agentskills.io spec) — underscores are rejected.

| Command | Key options |
|---------|-------------|
| `skills import` | `--file(-f)` (path to `SKILL.md`), `--dir(-d)`, `--recursive(-r)` (with `--dir`), `--workspace-id(-w)`, `--upsert(-u)` |
| `skills update` | update an existing skill with a new `SKILL.md` |
| `skills list` | Name · Description · Mode · Tools · Scripts · ID |
| `skills get` | `--skill-id(-s)` / `--skill-name(-n)` |
| `skills export` | export a skill to a zip/dir |
| `skills remove` | `--skill-id(-s)` / `--skill-name(-n)` |
| `skills upload-script` | attach an executable script to a skill |
| `skills upload-reference` | attach a reference doc to a skill |

```bash
orchestrate skills import -f skills/diagnostics_protocol/SKILL.md --upsert
orchestrate skills list
orchestrate skills get -n diagnostics-protocol
orchestrate skills export -n diagnostics-protocol -o ./skills_out
```

Import is **upsert-by-name** (a skill with the same `name` is updated in place). See
SKILL.md §3.3c for the `SKILL.md` frontmatter and the agent `skills:` field.

---

## toolkits — MCP toolkits

Group is **`toolkits`** (plural) in 2.10.0. Two ways in: `add` configures inline;
`import` reads a pre-written MCP spec file.

| Command | Key options |
|---------|-------------|
| `toolkits add` | `--kind(-k) mcp\|python`, `--name(-n)`, `--description` *(all required)*, `--package`, `--package-root`, `--language(-l) node\|python`, `--command`, `--url(-u)`, `--transport streamable_http\|sse`, `--tools(-t) "*"`, `--app-id(-a)` (repeatable; key_value only for STDIO MCP), `--allowed-context` (remote: `tenant_id`/`agent_id`), `--tier small\|medium\|large` (python) |
| `toolkits import` | `--file(-f)` *(required — path to the MCP spec file)*, `--app-id(-a)` |
| `toolkits list` | `--verbose(-v)` |
| `toolkits export` | `--name(-n)`, `--output` |
| `toolkits remove` | `--name(-n)` |

```bash
# Local stdio MCP server from a package dir (inline config)
orchestrate toolkits add -k mcp -n math_toolkit --description "Factorial tools" \
  --package-root ./mcp_server --language node \
  --command '["node","dist/index.js","--transport","stdio"]' --tools "*"

# Remote MCP server
orchestrate toolkits add -k mcp -n remote_toolkit --description "Remote tools" \
  --url https://my-mcp.example.com --transport streamable_http --tools "tool_a,tool_b"

# From a saved MCP spec file
orchestrate toolkits import -f toolkits/math_toolkit.yaml
```

`--command` accepts a single command string or a JSON-style arg list.
`--tools` is comma-separated or `"*"` for all.

---

## knowledge-bases

| Command | Key options |
|---------|-------------|
| `knowledge-bases import` | `--file(-f)`, `--safe` |
| `knowledge-bases list` | `--verbose(-v)` |
| `knowledge-bases status` | `--name(-n)` / `--id(-i)` |
| `knowledge-bases export` | `--name(-n)`/`--id(-i)`, `--output(-o)` |
| `knowledge-bases remove` | `--name(-n)`/`--id(-i)` |

```bash
orchestrate knowledge-bases import -f knowledge_base/kb.yaml
orchestrate knowledge-bases status -n my_kb       # check ingestion/indexing
```

---

## connections

| Command | Key options |
|---------|-------------|
| `connections add` | `--app-id(-a)` *(required)*, `--component` (e.g. `knowledge`/`registry`), `--category` (e.g. `milvus`) |
| `connections configure` | *Required:* `--app-id(-a)`, `--environment`/`--env` `[draft\|live]`, `--type(-t)` `[member\|team]`, `--kind(-k)` `[basic\|bearer\|api_key\|key_value\|kv\|oauth_*_flow]`. *Optional:* `--server-url`/`--url(-u)`, `--sso(-s)`, `--idp-token-use`, `--idp-token-type`, `--idp-token-header`, `--app-token-header`, `--config-entries(-e)`, **`--name(-n)`** (2.15.0 — custom API-key header name; `api_key` kind only) |
| `connections set-credentials` | *Required:* `--app-id(-a)`, `--environment`/`--env`. *Creds (by kind):* `--username(-u)`, `--password(-p)`, `--token`, `--api-key(-k)`, `--entries(-e)` `k=v`, `--token-entries(-t)`, `--auth-entries`; OAuth: `--client-id`, `--client-secret`, `--token-url`, `--auth-url`, `--scope`, `--grant-type`, `--send-via [header\|body]`; JWT Bearer (2.16): `--alg [RS256\|RS384\|RS512]`, `--private-key` (PEM **contents**), `--kid`, `--private-key-password`, `--iss`, `--aud`, `--exp`, `--include-jti`, `--claims k=v` |
| `connections set-identity-provider` | `--idp-token-header`, `--idp-token-use`, `--idp-token-type`, `--app-token-header` |
| `connections import` | `--file(-f)` |
| `connections export` | `--app-id(-a)` *(required)*, `--output(-o)` *(required)* — exports **one** connection |
| `connections list` | `--verbose(-v)` |
| `connections remove` | `--app-id(-a)` |

```bash
orchestrate connections add --app-id my_api
orchestrate connections configure -a my_api --kind api_key --type team --env draft
orchestrate connections set-credentials -a my_api --env draft --api-key "$MY_KEY"
orchestrate connections list
```

`--kind` (configure): `basic | bearer | api_key | key_value | kv |
oauth_auth_code_flow | oauth_auth_password_flow |
oauth_auth_client_credentials_flow | oauth_auth_on_behalf_of_flow |
oauth_auth_token_exchange_flow | oauth_auth_direct_access_flow |
oauth_auth_jwt_bearer_flow` (2.16; team only).
`--type`: `team` (shared) or `member` (per-user). `--env`: `draft` or `live`.

**Custom API-key header (2.15.0) — ⚠ broken on IBM Cloud SaaS at 2.15.0:**
```bash
orchestrate connections configure -a my_api --env draft -t team -k api_key \
  -u https://api.example.com --name "X-Auth-Token"     # instead of the default `api_key`
```
`--name` on any other `--kind` exits with *"Connection option 'name' is for custom API key
header name and can only be used with connection kind 'api_key'."* — that guard works.
The feature itself does not:
- **Create** reports success but persists nothing — `connections export` emits no `name`.
- **Update** returns `500 CM-UNKNOWN-001`,
  `details: column "name" of relation "application_connection_configs" does not exist`.
  The identical update **without** `--name` succeeds, isolating the flag as the trigger.

Verify on the target tenant before relying on it; otherwise use `--kind key_value` with an
explicit entry, or set the header in the tool code.

---

## models

| Command | Key options |
|---------|-------------|
| `models list` | list models available in the active env |
| `models import` | `--file(-f)` *(required)*, `--app-id(-a)` (a `key_value` connection with provider auth) |
| `models add` | `--name(-n)` *(required)*, `--description(-d)`, `--display-name`, `--provider-config` (JSON), `--app-id(-a)`, `--type [chat\|chat_vision\|completion\|embedding]` (default `chat`) |
| `models export` | `--name(-n)`, `--output(-o)` |
| `models remove` | `--name(-n)` |
| `models config` | tenant-level model selection subgroup: `list`, `default` (set default LLM), `denylist`, `reset`, `import`, `export`, plus **`enable-premier-models`** / **`disable-premier-models`** / **`are-premier-models-enabled`** (2.13.0) |
| `models policy` | routing pseudo-models across downstream models: `add`, `remove`, `import`, `export` |

```bash
orchestrate models list
orchestrate models import -f models/granite.yaml --app-id watsonx_credentials
orchestrate models config default          # set the tenant default LLM (was `models default` in older versions)
orchestrate models config list
```

---

## server — Developer Edition (local, Docker)

| Command | Key options |
|---------|-------------|
| `server start` | `--env-file(-e)`, `--with-langfuse(-l)`, `--with-ibm-telemetry(-i)`, `--with-doc-processing(-d)`, `--accept-terms-and-conditions` |
| `server stop` | — |
| `server reset` | wipe local tenant state |
| `server logs` | tail service logs |
| `server purge` | remove containers/volumes |
| `server edit` / `eject` / `ssh` / `attach-docker` / `release-docker` | advanced lifecycle |

```bash
orchestrate server start -e .env --accept-terms-and-conditions
orchestrate server logs
orchestrate server reset      # fresh local state
orchestrate server stop
```

---

## chat

| Command | Key options |
|---------|-------------|
| `chat start` | launch local chat UI |
| `chat ask <message>` | `--agent-name(-n)`, `--include-reasoning(-r)`, `--capture-logs(-l)`, `--thread-id(-t)` |
| `chat stop` | stop chat UI service |

```bash
orchestrate chat start
orchestrate chat ask -n weather_agent "What's the weather in Paris?" -r
orchestrate chat ask -n weather_agent "And tomorrow?" -t <thread_id>   # continue thread
```

---

## controls — policy guardrails (NEW in 2.15.0)

Binds a **policy artifact** to **agents / tools / models** at an execution hook.
Concepts, the artifact catalog, the enforcement proof and the traps are in SKILL.md §4a.

| Command | Flags |
|---|---|
| `controls list-types` | `--verbose(-v)` |
| `controls get-type` | `--name(-n)`*, `--verbose(-v)` |
| `controls create` | `--artifact(-a)`*, `--name(-n)`*, `--display-name`, `--description(-d)`, `--hooks/--hook` (repeatable), `--priority(-p)` (default 100, lower first), `--config` (JSON string), `--agent`/`--tool`/`--model` (each repeatable) |
| `controls list` | `--agent`, `--tool`, `--model`, `--artifact`, `--sort recent\|asc\|desc`, `--verbose(-v)` |
| `controls count` | — |
| `controls get-details` | `--name(-n)`*, `--verbose(-v)` |
| `controls update` | `--name(-n)`*, `--artifact`, `--new-name`, `--display-name`, `--description(-d)`, `--hooks/--hook`, `--priority(-p)`, `--config`, `--agent`/`--tool`/`--model` |
| `controls remove` | `--name(-n)`* |
| `controls import` | `--file(-f)`* (YAML or JSON) |
| `controls export` | `--name(-n)`*, `--output(-o)`* (YAML) |

`*` = required. **`remove`, not `delete`.**

Valid hooks (server-enforced; an invalid one returns a 422 that lists all six):
`agent_pre_invoke`, `agent_post_invoke`, `tool_pre_invoke`, `tool_post_invoke`,
`prompt_pre_fetch`, `prompt_post_fetch`.

⚠ Behaviour worth memorising (all live-verified 2.15.0):
- `--config` is **not** validated against the artifact's `config_schema` — typos are stored
  and the control silently runs on defaults.
- `--hooks` **is** validated. Asset-type mismatches and controls with **no** binding are
  **not** — the latter inflate `count` totals without appearing under any asset.
- `update` **replaces** each list it is given and preserves any flag you omit; `version` bumps.
- `import` is **create-only** (400 on an existing name); there is no `--upsert`.
- `export` writes agent **display** names, which `import` cannot resolve — rewrite them to
  snake_case first.

---

## workspaces

| Command | Purpose |
|---|---|
| `workspaces create` | Create or update a workspace |
| `workspaces list` | List workspaces with activation status |
| `workspaces remove` | Remove a workspace |
| `workspaces activate` / `deactivate` | Switch the active workspace / reset to global |
| `workspaces export` | Export all workspace resources to a zip |
| `workspaces members` | Manage workspace members |

Resources are scoped to the active workspace; `env activate` prints which one you are in,
and `tools list -v` reports a `workspace` field per tool. If a resource you imported seems
"missing", check you are in the same workspace.

---

## voice-configs

`import -f <yaml>` · `list` · `get` (by ID or name) · `export -n <name> -o <yaml>` ·
`remove`. Attach to an agent with `voice_configuration: <name>`. Schema and the 2.14/2.15
field additions: SKILL.md §4b. Export strips API keys.

---

## channels, evaluations, others

- **channels**: `create`, `delete`, `get`, `list`, `list-channels`, `import`, `export`, `webchat` — expose a deployed agent on a channel (e.g. embedded web chat). See `orchestrate channels webchat --help`.
- **evaluations**: `evaluate`, `quick-eval`, `generate`, `analyze`, `record`, `validate-native`, `validate-external`, `red-teaming` (see testing-debugging.md).
- **observability**: `traces search` / `traces export` — inspect agent execution traces.
  **2.13.0:** `search` filters by `--last <30m|3h|10d>` (relative window) or
  `--start-time`/`--end-time`, plus `--user-id` and `--session-id` (both repeatable),
  `--sort-field`/`--sort-direction`. The old `--service-name`/`--agent-name`/`--agent-id`/
  `--min-spans`/`--max-spans` filters are **deprecated / no longer supported** (the API no
  longer filters by agent). `export -t <32-hex trace-id>` returns **observations** (not spans):
  `{observations:[…], total_count, exported_at, format, trace_id}`; `--pretty` default,
  `-o` to write a file. (`search --last` now returns results on SaaS — it returned 0 in 2.12.0.)

  ```bash
  orchestrate observability traces search --last 3h            # Timestamp · Trace ID · Agent Name · Latency
  orchestrate observability traces export --trace-id <id> -o trace.json
  ```
  ⚠ **Three traps (live-verified 2.13.0):**
  1. The results table **still renders a populated `Agent Name` column** although
     `--agent-name` is a deprecated no-op — it reads as though the filter worked.
     **Filter client-side.**
  2. Results **mix sub-second infrastructure traces** (blank agent name, ~200–450ms) in with
     real agent runs. Exclude them from any error-rate or latency statistic.
  3. `export` returns a **strict subset** of the AgentOps v3 API — 11 fields, with **no
     `latency`** and **no `parentObservationId`**, so you cannot rebuild the span tree from
     it. For latency forensics use `GET /v1/agentops-v3/traces/{trace_id}`. See
     [agentops-evaluations.md](agentops-evaluations.md) §4.
- **settings**: configure the active env, including observability/Langfuse tracing.
- **voice-configs** / **phone**: voice-enabled agents (`import`, `list`, `get`, `export`, `remove`). 2.11+ adds Deepgram **Flux** STT models (Flux General English is the new default).
- **partners**: catalog/offering publishing. **workspaces**: multi-workspace management.
