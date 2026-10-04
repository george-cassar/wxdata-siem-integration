# Connections, Models (watsonx.ai AI Gateway) & Knowledge Bases

---

> 🔐 **This file covers connection *mechanics*.** For *which* auth kind to choose, the
> access-surface constraints that decide it, `member` vs `team` policy, RBAC, and identity
> propagation to downstream systems, load the companion skill
> **[`watsonx-orchestrate-aaa`](../../watsonx-orchestrate-aaa/SKILL.md)**.
>
> ⚠ Two corrections it carries that matter here: `oauth_auth_implicit_flow` **does not
> exist** in the shipped ADK (it is commented out), and two undocumented kinds do —
> `oauth_auth_token_exchange_flow` and `oauth_auth_direct_access_flow`.

## 1. Connections

A connection stores credentials/config for an external service, referenced by
`app_id`. Two halves: a **YAML definition** (structure) and **credentials** set
separately via the CLI. Never put real secrets in YAML.

### Connection YAML

```yaml
spec_version: v1
kind: connection            # singular!
app_id: my_api              # unique id; tools reference this
environments:
  draft:                    # at least 'draft' required; 'live' for production
    security_scheme: api_key_auth   # NOT 'kind' here
    type: team              # team (shared) | member (per-user)
    server_url: https://api.example.com
```

`security_scheme` values: `basic_auth`, `bearer_token`, `api_key_auth`,
`oauth2`, `key_value_creds`.

OAuth2 example (note `auth_type`):
```yaml
spec_version: v1
kind: connection
app_id: google_sheets
environments:
  draft:
    security_scheme: oauth2
    auth_type: oauth2_auth_code         # NOT 'authorization_code'
    type: team
    server_url: https://sheets.googleapis.com
    auth_url: https://accounts.google.com/o/oauth2/v2/auth
    token_url: https://oauth2.googleapis.com/token
    scope:
      - https://www.googleapis.com/auth/spreadsheets.readonly
```

### CLI lifecycle

```bash
orchestrate connections add --app-id my_api
orchestrate connections configure -a my_api --kind api_key --type team --env draft
orchestrate connections set-credentials -a my_api --env draft --api-key "$MY_KEY"
# basic auth:
orchestrate connections set-credentials -a my_api --env draft -u "$USER" -p "$PASS"
# key/value entries:
orchestrate connections set-credentials -a my_api --env draft --entries "api_key=$KEY"
orchestrate connections list
```

`--kind` (configure) values: `basic | bearer | api_key | key_value | kv |
oauth_auth_code_flow | oauth_auth_password_flow |
oauth_auth_client_credentials_flow | oauth_auth_on_behalf_of_flow |
oauth_auth_token_exchange_flow | oauth_auth_direct_access_flow |
oauth_auth_jwt_bearer_flow`.

**OAuth 2.0 JWT Bearer (2.16.0), live-verified 2.18.0.** Service-to-service auth: wxO signs
a JWT assertion with your private key and exchanges it at the token URL.
```bash
orchestrate connections add -a lab_api
orchestrate connections configure -a lab_api --env draft -t team -k oauth_auth_jwt_bearer_flow \
  -u https://lab.example.com
orchestrate connections set-credentials -a lab_api --env draft \
  --client-id my-client --token-url https://idp.example.com/oauth/token \
  --alg RS256 --private-key "$(cat key.pem)" [--private-key-password "$PW"] \
  [--kid key-1] [--iss …] [--aud …] [--exp 900] [--include-jti] [--claims dept=x --claims site=y]
```
- `-t member` is rejected: *"Connection kind 'oauth_auth_jwt_bearer_flow' can only be used
  with '--type team'"*.
- `--private-key` is the **PEM text**. A file path gets `400 Invalid private_key: error:1E08010C:DECODER
  routines::unsupported`.
- `--alg` is **RS256 / RS384 / RS512** only (`HS256` → `alg "HS256" is not permitted`).
- `--iss` defaults to the client id, `--aud` to the token URL, and `--exp` to 3600 s.
- The backend **performs a token request during `set-credentials`**. An unreachable token URL
  logs `503 … getaddrinfo ENOTFOUND`, then *"Credentials successfully set"*, so a failed probe
  does not block storage. Test against the real IdP to know the exchange works.
- `connections export` shows only `kind`, `type` and `server_url`; key material is never
  exported.

**Custom API-key header name (2.15.0).** By default an `api_key` connection sends the
credential in an `api_key` header. `--name` overrides that:
```bash
orchestrate connections configure -a my_api --env draft -t team -k api_key \
  -u https://api.example.com --name "X-Auth-Token"
```
- The kind guard works: on any `--kind` other than `api_key` the CLI exits with
  *"Connection option 'name' is for custom API key header name and can only be used with
  connection kind 'api_key'."* (live-verified 2.15.0).
- ⚠ **The feature itself did not work on IBM Cloud SaaS at 2.15.0.** Creating a
  configuration with `--name` reports success but stores nothing — `connections export`
  emits no `name`. **Updating** an existing configuration with `--name` fails outright:
  ```
  500 CM-UNKNOWN-001  {"details": "column \"name\" of relation
       \"application_connection_configs\" does not exist"}
  ```
  The same update without `--name` succeeds, so the flag is the trigger: the CLI ships the
  field, the backend schema does not have the column yet.
- **Workarounds** until the tenant catches up: use `--kind key_value` with an explicit
  entry and read it in the tool, or set the header from the tool code via
  `ibm_watsonx_orchestrate.run.connections`. Re-test with a create + export after any
  platform upgrade.

**Tip:** keep secrets in a gitignored `.env`, `source ./.env`, and pass via
`--api-key "$VAR"` / `--entries "k=$VAR"` so they stay out of shell history.

Connection types used in tool `ExpectedCredentials`: `ConnectionType.BASIC_AUTH`,
`BEARER_TOKEN`, `API_KEY_AUTH`, `OAUTH2_AUTH_CODE`, `OAUTH2_PASSWORD`,
`OAUTH2_CLIENT_CREDS`, `KEY_VALUE`.

---

## 2. Models via the watsonx.ai AI Gateway

List what the active env offers, then reference by full id in agent YAML:
```bash
orchestrate models list
```
Examples: `watsonx/meta-llama/llama-3-3-70b-instruct`,
`watsonx/ibm/granite-3-3-8b-instruct`, `groq/openai/gpt-oss-120b`.

**Provider enum (`ModelProvider`, unchanged 2.15.0 → 2.18.0)** — the value that goes in a `kind: model` YAML:
`openai`, `openai-oauth2-client-creds`, `a21`, `anthropic`, `anyscale`, `azure-openai`,
`azure-ai`, `bedrock`, `cerebras`, `cohere`, `google`, `vertex-ai`, `groq`, `huggingface`,
`mistral-ai`, `jina`, `ollama`, `openrouter`, `stability-ai`, `together-ai`, `watsonx`,
`x-ai`, **`redhat-ai`** (new in 2.14.0).
⚠ The 2.14.0 release note calls the last one **`red_hat_ai`** — that string is **not** in
the enum. Use `redhat-ai`.

**`models list` is not the whole story (live-verified 2.18.0).** A tenant whose list showed
only `groq/openai/gpt-oss-120b`, `bedrock/openai.gpt-oss-120b-1:0` and
`watsonx-orchestrate/frontier` still served **`bedrock-mantle/google.gemma-4-31b`** (Gemma 4
31B, 2.18.0 public preview; ReAct Core is applied automatically). The agent imported,
deployed and answered, and the trace showed `model: google.gemma-4-31b`. `agents import` does
not validate `llm`, so prove a model with one real chat.

**Azure authentication modes (2.17.0).** API key, managed identity and Microsoft Entra ID.
In the 2.18.0 ADK the auth fields are accepted on **`azure-ai`** only:

| Provider | Accepted `provider_config` keys (besides `api_key`, `custom_host`, …) |
|---|---|
| `azure-openai` | `azure_resource_name`, `azure_deployment_id`, `azure_api_version`, `azure_model_name` |
| `azure-ai` | the above + `ad_auth`, **`azure_auth_mode`**, **`azure_managed_client_id`**, **`azure_entra_client_id`**, **`azure_entra_client_secret`**, **`azure_entra_tenant_id`**, `azure_ad_token`, `azure_inference_deployment_name`, `azure_inference_api_version`, `azure_inference_extra_params`, `azure_inference_foundry_url` |

Putting the auth keys on `azure-openai` only triggers *"The config option 'azure_auth_mode'
is not used by provider 'azure-openai'"* and the setting is ignored (source-verified; the
accepted `azure_auth_mode` string values are not enumerated in the ADK, so check the
platform docs). In Developer Edition, `AZURE_OPENAI_API_KEY` adds `azure-openai/gpt-5.4`, but
Azure cannot be the *only* provider configured.

**Premier models (2.13.0)** — premier models (e.g. GPT-5.4) are **off by default** and are
marked `$` in `models list`. Enable them tenant-wide first, or they won't be selectable:
```bash
orchestrate models config are-premier-models-enabled   # check state
orchestrate models config enable-premier-models         # opt in
orchestrate models config disable-premier-models
```

### Adding your own watsonx.ai model

**Provider config schema** (`provider_config` / connection entries):
```jsonc
{
  "api_key": "string",                 // required
  "watsonx_space_id": "string",        // need at least one of space/project/deployment
  "watsonx_project_id": "string",
  "watsonx_deployment_id": "string",
  "watsonx_cpd_url": "string",         // on-prem (CPD) only
  "watsonx_cpd_username": "string",    // on-prem (CPD) only
  "watsonx_cpd_password": "string",    // on-prem (CPD) only
  "watsonx_version": "string",
  "custom_host": "string",
  "request_timeout": 30,
  "transform_to_form_data": false
}
```

**Steps**
```bash
# 1) credentials connection for watsonx.ai
orchestrate connections add --app-id watsonx_credentials
orchestrate connections configure -a watsonx_credentials --kind key_value --type team --env draft
source ./.env
orchestrate connections set-credentials -a watsonx_credentials --env draft \
  --entries "api_key=${WATSONX_APIKEY}"
# add watsonx_space_id / watsonx_project_id / watsonx_deployment_id as needed
```

```yaml
# 2) models/granite.yaml
spec_version: v1
kind: model
name: watsonx/ibm/granite-3-3-8b-instruct
display_name: IBM watsonx.ai (Granite)
description: IBM watsonx.ai model using Space-scoped configuration.
tags: [ibm, watsonx]
model_type: chat
provider_config:
  watsonx_space_id: my-space-id
```

```bash
# 3) import
orchestrate models import -f models/granite.yaml --app-id watsonx_credentials
# 4) (optional) make it the tenant default (2.10.0: under `models config`)
orchestrate models config default
```

If import warns about missing required fields (e.g. `api_key`), re-run
`set-credentials` to add the missing entries. Keep the model `name` stable across
environments; only `provider_config` / credentials differ between dev/stage/prod.

---

## 3. Knowledge bases (RAG)

### Built-in Milvus (managed — default choice)
```yaml
spec_version: v1
kind: knowledge_base
name: product_docs
description: Product documentation for grounding answers.
documents:
  - path: doc1.pdf
  - path: doc2.pdf
vector_index:
  embeddings_model_name: ibm/slate-125m-english-rtrvr-v2
```
No external infra; supports PDF/DOCX/PPTX/XLSX/CSV/HTML/TXT.
⚠ **`.md` is rejected** — `Unsupported file type text/markdown for file named x.md`
(live-verified 2.15.0). Rename Markdown sources to `.txt` before ingesting. (Agent
*skills* are the exception that confuses people: those are authored as `SKILL.md`, but
they are not knowledge bases.)
`orchestrate knowledge-bases import -f kb.yaml` then
`orchestrate knowledge-bases status -n product_docs` to watch ingestion.

### External providers (`conversational_search_tool.index_config`)
Set `prioritize_built_in_index: false` and an `app_id` connection.

- **AstraDB** — `astradb:` block (`api_endpoint`, `collection`/`table`,
  `embedding_model_id`, `embedding_mode: server|client`, `search_mode:
  vector|lexical|hybrid`, `field_mapping`). Auth: **API key**.
- **External Milvus** — `milvus:` block (`endpoint`, `collection_name`,
  `embedding_provider`, `embedding_model`, `embedding_dimension`, `field_mapping`).
  Auth: **basic**.
- **Elasticsearch** — `elasticsearch:` block (`endpoint`, `index_name`,
  `embedding_field`, `field_mapping`). Auth: **API key or basic**.

Example (Elasticsearch):
```yaml
spec_version: v1
kind: knowledge_base
name: es_kb
description: KB on Elasticsearch
app_id: es_conn
prioritize_built_in_index: false
conversational_search_tool:
  index_config:
    - elasticsearch:
        endpoint: 'https://es.example.com'
        index_name: my_index
        embedding_field: vector_embedding
        field_mapping: { title: title, body: content, url: url }
```

### Unsupported stores → custom RAG tool
For Pinecone, Weaviate, Qdrant, Chroma, proprietary search, etc., **don't** use a
knowledge base — write a Python `@tool` that queries the store and returns
results, then attach it to the agent and instruct it to cite sources. (Pattern in
agents-tools-schemas.md.)

### Reference an agent to a KB
```yaml
knowledge_base:                # 2.15.0 — an agent may list SEVERAL knowledge bases
  - product_docs
  - support_policies
```

**Multiple KBs per agent (2.15.0).** Each KB is exposed as its **own retrieval tool named
after the KB**, and the model chooses between them from the KB's `description` — exactly
like tool routing. Live-verified: one question spanning two KBs produced two tool calls
(`["ppth_formulary", "ppth_policy"]`) in `step_history` and two matching observations in
the exported trace.

Consequences for design:
- Write each KB `description` as a **routing trigger**, mutually exclusive from its siblings.
- State in the agent's `instructions:` which question class goes to which KB, and that a
  cross-cutting question must consult **both** — otherwise the agent tends to stop at the
  first hit.
- Split only when the sub-corpora answer *different kinds of question*. A homogeneous
  corpus should stay one KB.

**2.14.0 changes:** credentials are now validated at KB create/update time, before
indexing starts (a bad credential fails fast instead of after a long ingest); and
`index_config.url` is **optional** — the URL may come from the connection instead.

### Decision tree
```
Existing vector DB?
├─ No → Built-in Milvus (managed)
└─ Yes → AstraDB / Milvus / Elasticsearch provider blocks
         else (Pinecone/Weaviate/Qdrant/Chroma/custom) → custom Python @tool
```
