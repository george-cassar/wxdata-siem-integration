# Project & runtime administration — create projects, attach a watsonx.ai Runtime

> **Verified live (2026-06-12)** against `ibm-watsonx-ai` 1.5.13 and the Watson
> Data / Projects API: created a `type: wx` project with the same IBM Cloud API
> key used for inference, attached an existing watsonx.ai Runtime to it, attached
> a second runtime to the already-existing project, and deleted it. All steps
> below ran with HTTP 201/200/204 as noted.

This is a **different API from the watsonx.ai Runtime** (`/ml/v1`, `/ml/v4`).
Projects, their storage, and their attached compute are managed by the **Watson
Data / Projects API** (`api.dataplatform.cloud.ibm.com/v2/projects`) and the
**Resource Controller** (`resource-controller.cloud.ibm.com`). The good news:
**the same IBM Cloud API key / IAM token works for all of them** — you do not
need a different credential. The SDK wraps the Projects API under
`client.projects`.

## TL;DR — yes, one API key can do both

| Question | Answer |
|---|---|
| Create a new watsonx.ai project with the inference API key? | **Yes.** `client.projects.store(...)` or `POST /transactional/v2/projects` → 201. |
| Attach an existing watsonx.ai Runtime to it? | **Yes**, as project `compute` — at create time, or later via update/PATCH. |
| Does the project *provision* a new runtime? | **No.** You attach an **existing** `pm-20` instance by its CRN/GUID. Provisioning a new instance is Resource Controller's job. |
| Is storage optional? | **No.** A Cloud Object Storage (COS) instance is **mandatory** (`STORAGE` is required). |

## What you need first (discover, don't hardcode)

Three things, all discoverable from the live account with the same token:

1. **A COS instance** (storage — required). Service segment `cloud-object-storage`.
2. **A watsonx.ai Runtime instance** to attach (compute). Service segment
   `pm-20` (this is the watsonx.ai Runtime / Watson Machine Learning service).
3. The **account id** and **region** — both are encoded in the instance CRNs.

List them from the Resource Controller:

```bash
curl -s "https://resource-controller.cloud.ibm.com/v2/resource_instances?limit=200" \
  -H "Authorization: Bearer $IAM_TOKEN" \
| jq -r '.resources[]
    | select((.crn|split(":")[4]) as $s | $s=="pm-20" or $s=="cloud-object-storage")
    | "\(.crn|split(":")[4])\t\(.name)\t\(.crn)"'
```

A `pm-20` CRN looks like:
`crn:v1:bluemix:public:pm-20:us-south:a/<ACCOUNT>:<INSTANCE_GUID>::`
A COS CRN looks like:
`crn:v1:bluemix:public:cloud-object-storage:global:a/<ACCOUNT>:<INSTANCE_GUID>::`

> Keep the runtime's **region** consistent with the watsonx.ai URL you infer
> against (e.g. a `us-south` `pm-20` instance pairs with
> `https://us-south.ml.cloud.ibm.com`). The CRN's 6th segment is the region.

## Path A — SDK (`client.projects`)

The SDK exposes the full surface. `meta_props` keys come from
`client.projects.ConfigurationMetaNames` (`.show()` to print them):

| Meta prop | Required | Notes |
|---|---|---|
| `NAME` | Y | |
| `STORAGE` | **Y** | COS reference dict (see below) |
| `COMPUTE` | N | the watsonx.ai Runtime to attach |
| `TYPE` | N | `wx` for a watsonx project (vs `cpd`) |
| `GENERATOR` | Y | any string (defaults to `Watsonx-Python-SDK`) |
| `DESCRIPTION`, `TAGS`, `PUBLIC`, `TOOLS`, `ENFORCE_MEMBERS` | N | |

```python
from ibm_watsonx_ai import Credentials, APIClient

client = APIClient(Credentials(url="https://us-south.ml.cloud.ibm.com",
                               api_key=IBM_CLOUD_API_KEY))
meta = client.projects.ConfigurationMetaNames
COS_CRN = "crn:v1:bluemix:public:cloud-object-storage:global:a/<ACCT>:<COS_GUID>::"
WML_CRN = "crn:v1:bluemix:public:pm-20:us-south:a/<ACCT>:<WML_GUID>::"

details = client.projects.store(meta_props={
    meta.NAME: "my-new-project",
    meta.GENERATOR: "my-tool",
    meta.TYPE: "wx",
    meta.STORAGE: {
        "type": "bmcos_object_storage",
        "guid": "<COS_GUID>",
        "resource_crn": COS_CRN,
    },
    meta.COMPUTE: {                       # attach the existing Runtime
        "name": "my watsonx.ai Runtime",
        "type": "machine_learning",
        "guid": "<WML_GUID>",
        "crn": WML_CRN,
    },
})
project_id = client.projects.get_id(details)

# Inspect / change / remove later:
client.projects.get_details(project_id)
client.projects.update(project_id, changes={...})   # e.g. attach another runtime
client.projects.list()
client.projects.delete(project_id)
```

Use this `project_id` exactly as in §2 of the main skill:
`client.set.default_project(project_id)` and start inferencing.

## Path B — REST (curl / non-Python)

Same token as §6 of the main skill. The Projects API host is
`api.dataplatform.cloud.ibm.com` (note: **not** the `…ml.cloud.ibm.com` runtime
host).

**Create (async — returns a `location`, HTTP 201):**
```bash
curl -s -X POST "https://api.dataplatform.cloud.ibm.com/transactional/v2/projects" \
  -H "Authorization: Bearer $IAM_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "my-new-project",
    "type": "wx",
    "generator": "my-tool",
    "storage": { "type": "bmcos_object_storage",
                 "guid": "<COS_GUID>", "resource_crn": "<COS_CRN>" },
    "compute": [ { "name": "my watsonx.ai Runtime", "type": "machine_learning",
                   "guid": "<WML_GUID>", "crn": "<WML_CRN>" } ]
  }'
# -> {"location":"/v2/projects/<NEW_PROJECT_ID>"}
```

**Read:** `GET  /v2/projects/<id>` → 200; `entity.compute[]` lists attached runtimes.
**Attach a runtime to an existing project:** `PATCH /v2/projects/<id>` with the
full desired `compute` array → 200.
**Delete:** `DELETE /transactional/v2/projects/<id>` → 204.

## Gotchas (each cost a request to find)

- **COS storage is mandatory.** No `storage` → the project won't create. You must
  already have (or provision) a Cloud Object Storage instance.
- **You attach an *existing* runtime, not a new one.** `compute` references a
  `pm-20` instance by CRN+GUID. If the account has no watsonx.ai Runtime yet,
  create one via Resource Controller / catalog first — the Projects API won't.
- **PATCH compute requires `credentials` on each entry; create does not.**
  A `PATCH` whose `compute[]` entries lack a `credentials` field returns
  `400 WSCPA0000E "Missing required properties for compute: credentials"`. Add an
  empty object — `"credentials": {}` — to each entry. (At **create** time the
  field can be omitted.)
- **Create is asynchronous.** REST returns `{"location": "/v2/projects/<id>"}`,
  not the full project; GET the id to confirm `compute`/`storage` landed.
- **Two different hosts.** Projects API → `api.dataplatform.cloud.ibm.com`;
  inference → `<region>.ml.cloud.ibm.com`. Same token, different base URL.
- **Account/region come from the CRN.** The COS and runtime CRNs embed
  `a/<account>` and a region; attach instances from the **same account**, and keep
  the runtime region aligned with the inference URL you'll use.

## Permissions

Doing this with an API key requires the identity behind the key to have the
right IAM access (project creation, and at least *Viewer*/*Operator* on the COS
and `pm-20` instances being referenced). A key scoped only to inference on one
project may get `403` on `POST /v2/projects` or when referencing an instance it
can't see — that's an IAM grant issue, not an API limitation.
