# Classic ML Lifecycle & the REST API

Two things in one file: the SDK lifecycle managers (`client.repository`,
`client.deployments`, `client.training`) and the raw watsonx.ai Runtime REST API
(`/ml/v1` generative + `/ml/v4` lifecycle).

---

## Part A — SDK lifecycle: store → deploy → score

Deployments live in a **space**: `client.set.default_space("SPACE_ID")`.

### Store a model
```python
meta = {
    client.repository.RepositoryMetaNames.NAME: "my_model",
    client.repository.RepositoryMetaNames.SOFTWARE_SPEC_ID:
        client.software_specifications.get_id_by_name("runtime-24.1-py3.11"),
    client.repository.RepositoryMetaNames.TYPE: "scikit-learn_1.3",
}
details  = client.repository.store_model(model_object, meta_props=meta)
model_id = client.repository.get_model_id(details)
```

### Create a deployment (online or batch)
```python
# Online (synchronous scoring)
dep = client.deployments.create(model_id, meta_props={
    client.deployments.ConfigurationMetaNames.NAME: "my-online-dep",
    client.deployments.ConfigurationMetaNames.ONLINE: {},
    client.deployments.ConfigurationMetaNames.HARDWARE_SPEC: {"name": "S"},
})
dep_id = client.deployments.get_id(dep)

# Batch (asynchronous jobs)
client.deployments.create(model_id, meta_props={
    client.deployments.ConfigurationMetaNames.NAME: "my-batch-dep",
    client.deployments.ConfigurationMetaNames.BATCH: {},
    client.deployments.ConfigurationMetaNames.HARDWARE_SPEC: {"name": "S", "num_nodes": 1},
})
```

### Score
```python
# Online
client.deployments.score(dep_id, {
    client.deployments.ScoringMetaNames.INPUT_DATA: [
        {"fields": ["f1", "f2"], "values": [[1, 2], [3, 4]]}
    ]
})

# Batch job
job = client.deployments.create_job(dep_id, meta_props={
    client.deployments.ScoringMetaNames.INPUT_DATA_REFERENCES: [...],
    client.deployments.ScoringMetaNames.OUTPUT_DATA_REFERENCE: {...},
})
client.deployments.get_job_status(client.deployments.get_job_id(job))
```

### Useful managers
`client.spaces`, `client.connections`, `client.data_assets`,
`client.hardware_specifications`, `client.software_specifications`,
`client.training` (custom training runs), `client.model_definitions`,
`client.deployments.list()`, `client.repository.list()`.

---

## Part B — REST API

Base = your **regional service URL** (e.g. `https://us-south.ml.cloud.ibm.com`).
**Every** request needs `?version=YYYY-MM-DD` and `Authorization: Bearer <IAM_TOKEN>`
(exchange the api key for a token — see setup-auth.md).

### B1. Generative inference — `/ml/v1/text/*`
The REST behind `ModelInference`. Body carries `model_id`, the input, and
`project_id` **or** `space_id`.

| Endpoint | Purpose |
|---|---|
| `POST /ml/v1/text/generation` | text generation |
| `POST /ml/v1/text/generation_stream` | streaming generation (SSE) |
| `POST /ml/v1/text/chat` | chat completions |
| `POST /ml/v1/text/chat_stream` | streaming chat (SSE) |
| `POST /ml/v1/text/embeddings` | embeddings |
| `POST /ml/v1/text/rerank` | rerank |
| `POST /ml/v1/text/tokenization` | tokenize / count |
| `GET  /ml/v1/foundation_model_specs` | list available foundation models |

```bash
curl -X POST "$URL/ml/v1/text/chat?version=2024-05-01" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model_id":"ibm/granite-3-3-8b-instruct",
       "project_id":"PROJECT_ID",
       "messages":[{"role":"user","content":"Hello"}],
       "max_tokens":200}'
```
> Pin a `version` date that matches your payload; bodies evolve across versions.
> Confirm exact field names against the live watsonx.ai REST docs for `/ml/v1`.

### B2. Lifecycle — `/ml/v4/*` (the provided REST reference)
This is the API documented in `REFERENCE-watsonx.ai-REST-API/`
(`machine-learning.json` + `readme.txt`). Endpoint groups:

| Group | Paths |
|---|---|
| Deployments | `POST,GET /ml/v4/deployments`, `GET,PATCH,DELETE /ml/v4/deployments/{id}`, `POST /ml/v4/deployments/{id}/predictions` |
| Batch jobs | `POST,GET /ml/v4/deployment_jobs`, `GET,DELETE /ml/v4/deployment_jobs/{job_id}` |
| Job definitions | `…/ml/v4/deployment_job_definitions[/{id}][/revisions]` |
| Models | `…/ml/v4/models[/{id}][/content][/download][/revisions]` |
| Model definitions | `…/ml/v4/model_definitions[/{id}][/model][/revisions]` |
| Trainings | `POST,GET /ml/v4/trainings`, `GET,DELETE /ml/v4/trainings/{id}` |
| Training definitions | `…/ml/v4/training_definitions[/{id}][/revisions]` |
| Experiments | `…/ml/v4/experiments[/{id}][/revisions]` |
| Functions | `…/ml/v4/functions[/{id}][/code][/revisions]` |
| Pipelines | `…/ml/v4/pipelines[/{id}][/revisions]` |
| Instances | `GET /ml/v4/instances[/{id}]` |

Online predict example:
```bash
curl -X POST "$URL/ml/v4/deployments/$DEPLOYMENT_ID/predictions?version=2021-05-01" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"input_data":[{"fields":["f1","f2"],"values":[[1,2]]}]}'
```

### Data references (training & batch I/O)
Remote input/output uses reference objects (see `readme.txt`):
- `data_asset` → `{"type":"data_asset","location":{"href":"/v2/assets/<id>?space_id=<sid>"}}`
- `connection_asset` → `{"type":"connection_asset","connection":{"id":"<guid>"},"location":{...}}`
- `url` → Decision Optimization only.

### Versioning & errors
- `version=YYYY-MM-DD` is required on every call; the service uses that version or
  the most recent before it. Don't default to "today" — pin a date you tested.
- Standard HTTP codes: 200/202 success, 400 bad request, 401 unauthorized,
  403 forbidden (often wrong space/project or region), 404 not found. Error body
  carries `trace` + `errors[].code/message/more_info`.
- Job-creation is asynchronous (since `2021-05-01`): poll the job until
  `platform_jobs` is populated.
