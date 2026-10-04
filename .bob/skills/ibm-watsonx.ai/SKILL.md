---
name: ibm-watsonx-ai
description: >-
  Build, run, tune, and deploy AI on IBM watsonx.ai using the `ibm-watsonx-ai`
  Python SDK and the watsonx.ai Runtime REST API. Use this whenever the user
  mentions watsonx.ai, watsonx.ai Runtime, Watson Machine Learning (WML),
  `ibm-watsonx-ai`, foundation-model inference / chat / streaming, embeddings,
  reranking, text extraction/classification, RAG on watsonx, prompt templates,
  prompt tuning or fine-tuning, AutoAI, or storing / deploying / scoring a model
  (online or batch) in a watsonx.ai project or deployment space. Covers both the
  Python SDK (primary) and the raw REST endpoints (generative `/ml/v1/*` and the
  lifecycle `/ml/v4/*` API).
metadata:
  enabled: true
---

# IBM watsonx.ai — Inference · Embeddings · RAG · Tune · Deploy

Authoritative, end-to-end guide for building on IBM **watsonx.ai** (the AI
runtime formerly branded Watson Machine Learning). It is grounded in the real
**`ibm-watsonx-ai` Python SDK** and the **watsonx.ai Runtime REST API**, not
guesswork.

> **Golden rule:** the SDK moves fast. The class/method specifics here were
> verified against **`ibm-watsonx-ai` 1.5.x** (docs snapshot v1.5.11) and the
> watsonx.ai Runtime REST spec. When a method, parameter, or model id is
> uncertain — or you're on a different version — **verify against the live tool**:
> `pip show ibm-watsonx-ai`, `python -c "import ibm_watsonx_ai; help(...)"`, the
> live docs (§10), and, for model ids, **list them from the live service**
> (§4) rather than trusting any hardcoded list. Model ids deprecate on a published
> lifecycle — never assume a model still exists.

---

## 1. Mental model — what you are building

watsonx.ai is one runtime with two broad capability sets, reached through one
Python SDK or the REST API:

| Capability | What it does | Primary SDK entry point |
|---|---|---|
| **Foundation-model inference** | Text generation, chat, streaming, tokenize | `foundation_models.ModelInference` |
| **Embeddings** | Vectorize text for search/RAG | `foundation_models.Embeddings` |
| **Other FM tasks** | Rerank, text extraction, classification, moderation/guardrails, time-series, audio | `foundation_models.*` |
| **RAG** | Vector stores, chunkers, retrievers over your data | `foundation_models.extensions.rag.*` |
| **Prompt templates** | Store/parametrize reusable prompts | `foundation_models.prompts.*` |
| **Tuning** | Prompt tuning / fine-tuning / InstructLab | `experiment.TuneExperiment` |
| **Classic ML lifecycle** | Store → deploy (online/batch) → score traditional models; AutoAI; training | `client.repository`, `client.deployments`, `client.training` |
| **Project / runtime admin** | Create a project, attach an existing watsonx.ai Runtime, manage members | `client.projects` (Projects API, not `/ml/*`) |

Two surfaces you work through:

- **The `ibm-watsonx-ai` Python SDK** — the primary, highest-level interface.
  Everything below is SDK-first.
- **The watsonx.ai Runtime REST API** — when you're not in Python (another
  language, a thin service, curl). Two families:
  - **Generative inference** `…/ml/v1/text/*` (generation, chat, embeddings, …)
  - **Lifecycle** `…/ml/v4/*` (deployments, trainings, models, jobs) — this is
    the API documented in the provided REST reference.

**The one concept that trips everyone up — project vs space:** every call runs
against **either** a `project_id` (experimentation/notebooks) **or** a `space_id`
(deployment space for production assets). **Exactly one is mandatory** on the
client or on each foundation-model object. Set it once (§2) and reuse.

---

## 2. Prerequisites & connect (do this first)

- **Python 3.10–3.12.** Use a real version (`python3.12`), not the system `python3`
  (often 3.9, which fails). Work in a virtualenv.
- **Install:** `pip install -U "ibm-watsonx-ai"`. (Extras exist for RAG, e.g.
  `ibm-watsonx-ai[rag]`.) Confirm: `pip show ibm-watsonx-ai`.
- You need an **IBM Cloud API key** (or an IAM bearer token) and a **project_id**
  or **space_id**, plus your **regional service URL**.

```python
from ibm_watsonx_ai import Credentials, APIClient

credentials = Credentials(
    url="https://us-south.ml.cloud.ibm.com",   # pick your region (table below)
    api_key=IBM_CLOUD_API_KEY,                  # or token="<IAM bearer token>"
)
client = APIClient(credentials)
client.set.default_project("PROJECT_ID")        # OR: client.set.default_space("SPACE_ID")
```

**Regional service URLs** (IBM Cloud): Dallas `https://us-south.ml.cloud.ibm.com`,
Frankfurt `https://eu-de.ml.cloud.ibm.com`, London `https://eu-gb.ml.cloud.ibm.com`,
Tokyo `https://jp-tok.ml.cloud.ibm.com`, Sydney `https://au-syd.ml.cloud.ibm.com`,
Toronto `https://ca-tor.ml.cloud.ibm.com`, Mumbai (AWS) `https://ap-south-1.aws.wxai.ibm.com`.

For **Cloud Pak for Data (on-prem)** the `Credentials` differ (host + username +
api_key/password + `instance_id="openshift"` + `version`). Full cloud & CPD auth,
env-var patterns, and token refresh are in
**[references/setup-auth.md](references/setup-auth.md)**.

> 🔒 **Treat the API key / token as a secret.** Read it from an env var
> (`os.environ`), never hardcode it in code, notebooks, or commits. Don't print
> tokens. Rotate if exposed.

---

## 3. The capabilities (SDK-first)

### 3.1 Foundation-model inference — `ModelInference`

```python
from ibm_watsonx_ai.foundation_models import ModelInference
from ibm_watsonx_ai.foundation_models.schema import TextGenParameters, TextGenDecodingMethod

model = ModelInference(
    model_id="ibm/granite-3-3-8b-instruct",   # list live ids first — see §4
    api_client=client,                        # reuses the project/space you set
    # or: credentials=credentials, project_id="..." / space_id="..."
)

# Simple text
print(model.generate_text(prompt="Explain RAG in one sentence."))

# Tuned decoding (typed params, or a dict of GenTextParamsMetaNames)
params = TextGenParameters(decoding_method=TextGenDecodingMethod.SAMPLE,
                           temperature=0.7, max_new_tokens=200)
print(model.generate_text(prompt="...", params=params))

# Streaming
for chunk in model.generate_text_stream(prompt="Write a haiku about Kubernetes."):
    print(chunk, end="", flush=True)
```

**Chat (multi-turn, system prompt, tools/function-calling):**
```python
messages = [
    {"role": "system", "content": "You are a concise assistant."},
    {"role": "user", "content": "Who won the 2020 World Series?"},
]
resp = model.chat(messages=messages)             # add tools=[...], tool_choice_option="auto"
print(resp["choices"][0]["message"]["content"])  # streaming: model.chat_stream(...)
```

Key `ModelInference` methods: `generate_text` (→ str), `generate` (→ raw dict
with `results[0].generated_text`), `generate_text_stream`, `chat`, `chat_stream`,
`tokenize`, `get_details`, `to_langchain()`. Response shapes, the full
`TextGenParameters` / `TextChatParameters` fields, tools/function-calling,
guardrails (HAP/PII/Granite Guardian), batching (`concurrency_limit`), async
(`generate(..., async_mode=True)`), and prompt templates are in
**[references/inference-chat.md](references/inference-chat.md)**.

### 3.2 Embeddings & RAG

```python
from ibm_watsonx_ai.foundation_models import Embeddings

emb = Embeddings(model_id="ibm/slate-30m-english-rtrvr", api_client=client)
vectors = emb.embed_documents(texts=["doc one", "doc two"])   # list[list[float]]
qvec    = emb.embed_query(text="a question")
```

The SDK ships a full RAG toolkit under
`foundation_models.extensions.rag`: `VectorStore` (with Milvus / Elasticsearch /
DB2 adapters), chunkers (`LangChainChunker`, `HybridSemanticChunker`), and
`Retriever`/`RetrievalMethod`. End-to-end RAG, plus rerank / text-extraction /
classification, are in **[references/embeddings-rag.md](references/embeddings-rag.md)**.

### 3.3 Tuning (prompt tuning / fine-tuning)

```python
from ibm_watsonx_ai.experiment import TuneExperiment

experiment = TuneExperiment(credentials, project_id="PROJECT_ID")
tuner = experiment.prompt_tuner(name="my-tuning", task_id=experiment.Tasks.CLASSIFICATION,
                                base_model="google/flan-t5-xl", num_epochs=6, learning_rate=0.2)
tuner.run(training_data_references=[...], background_mode=False)
model_id = tuner.get_model_id()       # deploy/infer like any model
```

Full prompt-tuning + fine-tuning + InstructLab + AutoAI is in
**[references/tuning.md](references/tuning.md)**.

### 3.4 Classic ML lifecycle — store → deploy → score

```python
client.set.default_space("SPACE_ID")              # deployments live in a SPACE, not a project
meta = {client.repository.RepositoryMetaNames.NAME: "my_model", ...}
model_details = client.repository.store_model(model_object, meta_props=meta)
model_id = client.repository.get_model_id(model_details)

dep = client.deployments.create(model_id, meta_props={
    client.deployments.ConfigurationMetaNames.NAME: "my-online-dep",
    client.deployments.ConfigurationMetaNames.ONLINE: {},
})
dep_id = client.deployments.get_id(dep)
client.deployments.score(dep_id, {
    client.deployments.ScoringMetaNames.INPUT_DATA: [{"fields": [...], "values": [[...]]}]
})
```

Online vs batch, hardware specs, software specs, batch jobs, training, and AutoAI
are in **[references/classic-ml-and-rest.md](references/classic-ml-and-rest.md)**.

### 3.5 Project & runtime administration — create a project, attach a Runtime

Provisioning a **project** and attaching a **watsonx.ai Runtime** to it is *not*
the `/ml/*` Runtime API — it's the **Watson Data / Projects API**, wrapped by
`client.projects`. **The same IBM Cloud API key works for both.** You attach an
*existing* `pm-20` (watsonx.ai Runtime) instance; the project does not provision
a new one, and a **COS storage instance is mandatory**.

```python
meta = client.projects.ConfigurationMetaNames           # NAME, STORAGE(req), COMPUTE, TYPE…
details = client.projects.store(meta_props={
    meta.NAME: "my-new-project",
    meta.TYPE: "wx",
    meta.GENERATOR: "my-tool",
    meta.STORAGE: {"type": "bmcos_object_storage", "guid": COS_GUID, "resource_crn": COS_CRN},
    meta.COMPUTE: {"name": "my Runtime", "type": "machine_learning",
                   "guid": WML_GUID, "crn": WML_CRN},   # attach existing pm-20 instance
})
project_id = client.projects.get_id(details)            # then set.default_project(project_id)
```

Discover the COS and `pm-20` CRNs from the Resource Controller (don't hardcode).
Verified live: create + attach + re-attach + delete all succeed with the
inference key. Full SDK+REST recipe, discovery, and gotchas (COS required; PATCH
compute needs `credentials: {}`; async create returns a `location`; IAM
permissions) are in
**[references/projects-and-runtime-admin.md](references/projects-and-runtime-admin.md)**.

---

## 4. Choosing a model — always list from the live service

**Never hardcode a model id as if it's guaranteed to exist** — models are added
and deprecated on a published lifecycle. Discover what the *connected* instance
offers:

```python
client.foundation_models.TextModels        # enum of text/generation model ids
client.foundation_models.ChatModels        # chat-capable ids
client.foundation_models.EmbeddingModels   # embedding ids
specs = client.foundation_models.get_model_specs()                 # full catalog + details
life  = client.foundation_models.get_model_lifecycle(model_id="ibm/granite-3-3-8b-instruct")
```

Reference a model by its full id string (e.g. `ibm/granite-3-3-8b-instruct`,
`meta-llama/llama-3-3-70b-instruct`, `ibm/slate-30m-english-rtrvr`). Pick chat
models for `chat()`, embedding models for `Embeddings`. Confirm availability and
**lifecycle status** before building on one.

---

## 5. Critical constraints (these cause silent failures — internalize them)

- ✅ **`project_id` xor `space_id` is mandatory** on the client or each FM object.
  "Set default space/project ID is mandatory." Missing it → auth/scope errors.
- ✅ **Deployments live in a `space`, experimentation in a `project`.** You'll
  often `set.default_project(...)` to build/tune and `set.default_space(...)` to
  deploy/score. Switching scope is the #1 "it worked in my notebook" gotcha.
- ✅ **`api_key` and `token` are alternatives, not both.** A `token` is a
  short-lived IAM bearer token; an `api_key` is exchanged for one automatically by
  the SDK. For raw REST you must exchange the api key yourself (§6).
- ✅ **Reuse one `APIClient`.** Pass `api_client=client` to FM objects instead of
  re-creating credentials — it carries your scope and connection pooling.
- ✅ **Model ids are not stable forever** — list them (§4) and check lifecycle.
- ✅ **Respect concurrency / rate limits.** `generate`/`embed_*` take
  `concurrency_limit` (defaults: generate 8, embeddings 5/max 10). Large batches
  → throttling; tune these, don't fan out unbounded.
- ✅ **Guardrails are opt-in.** `generate_text(..., guardrails=True)` enables
  HAP/PII moderation; off by default.
- ✅ **REST calls need a `version=YYYY-MM-DD` query param** and an IAM bearer
  token (not the raw api key).

---

## 6. REST API (when you're not in Python)

Same service, two endpoint families. Always send `?version=YYYY-MM-DD` and
`Authorization: Bearer <IAM_TOKEN>`.

**Get an IAM token from an api key:**
```bash
curl -s -X POST https://iam.cloud.ibm.com/identity/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=$IBM_CLOUD_API_KEY" | jq -r .access_token
```

**Generative inference** (`/ml/v1/text/*`) — the REST behind `ModelInference`:
```bash
curl -X POST "https://us-south.ml.cloud.ibm.com/ml/v1/text/generation?version=2024-05-01" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model_id":"ibm/granite-3-3-8b-instruct",
       "input":"Explain RAG in one sentence.",
       "parameters":{"max_new_tokens":200},
       "project_id":"PROJECT_ID"}'
```
Siblings: `/ml/v1/text/generation_stream`, `/ml/v1/text/chat`,
`/ml/v1/text/chat_stream`, `/ml/v1/text/embeddings`, `/ml/v1/text/rerank`,
`/ml/v1/text/tokenization`, and `/ml/v1/foundation_model_specs` (list models).

**Lifecycle** (`/ml/v4/*`) — the API in the provided REST reference: deployments,
online predictions (`/ml/v4/deployments/{id}/predictions`), batch
`deployment_jobs`, `trainings`, `models`, `experiments`, `functions`, `pipelines`,
`instances`. Endpoint catalog, payload shapes (`data_asset`/`connection_asset`
references), and version dates are in
**[references/classic-ml-and-rest.md](references/classic-ml-and-rest.md)**.

---

## 7. Debugging playbook

| Symptom | Likely cause → fix |
|---|---|
| `No project or space id provided` / scope errors | Call `client.set.default_project(...)` or `default_space(...)`, or pass `project_id`/`space_id` to the FM object. |
| `model_id not supported` / 404 on a model | Model deprecated or not in this region/plan. List live ids (§4); check `get_model_lifecycle`. |
| 401 / `Unauthorized` | Bad/expired token, or raw api key used where a bearer token is required (REST). Re-exchange the IAM token (§6). |
| 403 / `Forbidden` | Key lacks access to that project/space, or wrong region URL. |
| `generate_text` returns truncated text | `max_new_tokens` too low, or stop sequences hit. Raise `max_new_tokens`; inspect `model.generate(...)` raw `results`. |
| Deploy/score fails but inference works | You're in a *project*; deployments need a *space*. `set.default_space(...)` and re-run. |
| 429 / throttling on bulk calls | Lower `concurrency_limit`; batch and back off. |
| REST 400 `version` errors | Missing/invalid `?version=YYYY-MM-DD`. Pin a date your payload matches. |
| `ModuleNotFoundError` on RAG classes | Install the RAG extra: `pip install "ibm-watsonx-ai[rag]"`. |

More failure modes per area are in the referenced files.

---

## 8. Verify before handover

**Code that imports ≠ code that works.** Before reporting an inference/RAG/deploy
task as done, run a tiny real call against the connected instance and show the
output — one `generate_text`/`chat` round-trip, or one `score` on a deployment.
For anything that **writes** (creating a deployment, launching a tuning/training
job, storing assets): confirm scope (project vs space) and **state the cost/runtime
implication** before launching, since tunings/trainings consume capacity units.
Report status honestly: "ran and returned X", or "wrote deployment `<id>`; smoke
score returned Y".

---

## 9. Working alongside other skills / MCP (optional)

watsonx.ai is the model layer that **watsonx Orchestrate** agents and the **AI
Gateway** consume as a provider. If you're wiring a watsonx.ai model into an
Orchestrate agent (a `kind: model` YAML + `watsonx_credentials` connection), this
skill grounds the watsonx.ai side; the Orchestrate skill grounds the agent side.
If a TechZone environment is being provisioned to *get* a watsonx.ai instance,
that's the TechZone skill's job — this skill picks up once you have credentials.

---

## 10. References (load on demand)

| File | Contents |
|------|----------|
| [references/setup-auth.md](references/setup-auth.md) | `Credentials`/`APIClient` full surface, IBM Cloud vs Cloud Pak for Data (CPD), regions, env-var patterns, IAM token exchange/refresh, project vs space |
| [references/inference-chat.md](references/inference-chat.md) | `ModelInference` full method set, response shapes, `TextGenParameters`/`TextChatParameters` + decoding methods + metanames, tools/function-calling, guardrails, streaming, prompt templates |
| [references/embeddings-rag.md](references/embeddings-rag.md) | `Embeddings`, the `extensions.rag` toolkit (VectorStore + Milvus/Elasticsearch/DB2 adapters, chunkers, Retriever), rerank, text extraction/classification |
| [references/tuning.md](references/tuning.md) | Prompt tuning (`TuneExperiment`/`PromptTuner`), fine-tuning, InstructLab, AutoAI overview, training-data references |
| [references/classic-ml-and-rest.md](references/classic-ml-and-rest.md) | Store/deploy/score, online vs batch, hardware/software specs, batch jobs; the full REST API map (`/ml/v1` generative + `/ml/v4` lifecycle), versioning, data references |
| [references/projects-and-runtime-admin.md](references/projects-and-runtime-admin.md) | Create a project and attach an existing watsonx.ai Runtime with the same API key (SDK `client.projects` + Projects API REST); discovering COS/`pm-20` instances; COS-required / PATCH-credentials / async-create gotchas; IAM permissions |

### Canonical external resources (you have internet access — use them)
- **SDK docs (ground truth for signatures):** https://ibm.github.io/watsonx-ai-python-sdk/ (the local `REFERENCE-watsonx.ai-python-sdk` snapshot redirects here — fetch the live page when a signature is in doubt)
- **watsonx.ai docs:** https://www.ibm.com/docs/en/watsonx (foundation models, deploying AI, prompt lab)
- **REST API reference:** the provided `REFERENCE-watsonx.ai-REST-API/` (lifecycle `/ml/v4`) + the live watsonx.ai REST docs for `/ml/v1` generative endpoints
- **PyPI:** `ibm-watsonx-ai` — check the installed version with `pip show ibm-watsonx-ai`

**Always prefer the live SDK docs / `help()` over memory when a signature is in
doubt, and always list model ids from the live service (§4) rather than trusting a
hardcoded list.** This skill was verified against `ibm-watsonx-ai` 1.5.x.
