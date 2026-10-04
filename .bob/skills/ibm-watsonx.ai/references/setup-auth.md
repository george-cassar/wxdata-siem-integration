# Setup & Authentication

Grounded in `ibm-watsonx-ai` 1.5.x. Verify signatures against
https://ibm.github.io/watsonx-ai-python-sdk/ when in doubt.

## Install

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -U "ibm-watsonx-ai"            # add [rag] for the RAG extension extras
pip show ibm-watsonx-ai                     # confirm the version you're coding against
```
Python 3.10–3.12. Don't use a bare system `python3` (often 3.9).

## `Credentials` — IBM Cloud

```python
from ibm_watsonx_ai import Credentials, APIClient
import os

credentials = Credentials(
    url="https://us-south.ml.cloud.ibm.com",     # region URL (see table)
    api_key=os.environ["IBM_CLOUD_API_KEY"],     # OR token="<IAM bearer token>"
)
client = APIClient(credentials)
```

- `api_key` vs `token` are **alternatives**. With `api_key` the SDK exchanges and
  refreshes IAM tokens for you. A `token` is short-lived — only use it if you're
  managing refresh yourself.
- Other constructor params: `instance_id`, `verify` (bool / CA path), `proxies`.

### Regional service URLs (IBM Cloud)
| Region | URL |
|---|---|
| Dallas (us-south) | `https://us-south.ml.cloud.ibm.com` |
| Frankfurt (eu-de) | `https://eu-de.ml.cloud.ibm.com` |
| London (eu-gb) | `https://eu-gb.ml.cloud.ibm.com` |
| Tokyo (jp-tok) | `https://jp-tok.ml.cloud.ibm.com` |
| Sydney (au-syd) | `https://au-syd.ml.cloud.ibm.com` |
| Toronto (ca-tor) | `https://ca-tor.ml.cloud.ibm.com` |
| Mumbai (AWS) | `https://ap-south-1.aws.wxai.ibm.com` |

## `Credentials` — Cloud Pak for Data (on-prem / CPD)

```python
credentials = Credentials(
    url="https://<cpd-cluster-host>",
    username="<cpd-username>",
    api_key="<cpd-api-key>",          # OR password="<cpd-password>"
    instance_id="openshift",
    version="5.x",                     # your CPD version
    verify="/path/to/ca.crt",          # or False for self-signed (dev only)
)
client = APIClient(credentials)
```

## Project vs Space — set scope (mandatory)

Every call runs against exactly one of these. **Setting a default is mandatory.**

```python
client.set.default_project("PROJECT_ID")    # experimentation, notebooks, tuning
# or
client.set.default_space("SPACE_ID")        # deployments / production assets
```

- Find `project_id`: watsonx project → **Manage → General → Details**.
- Find/create spaces: `client.spaces.list()`, `client.spaces.store(...)`.
- You routinely switch: build/tune in a **project**, then `set.default_space(...)`
  to **deploy/score**. Re-set scope after switching.
- You can also pass `project_id=` / `space_id=` directly to `ModelInference`,
  `Embeddings`, etc., instead of relying on the client default.

## Env-var pattern (keep secrets out of code)

```python
import os
credentials = Credentials(url=os.environ["WATSONX_URL"], api_key=os.environ["WATSONX_APIKEY"])
PROJECT_ID = os.environ["WATSONX_PROJECT_ID"]
```
Export in a gitignored `.env`/shell profile. **Never** hardcode keys, print tokens,
or commit them. Rotate if exposed.

## Raw IAM token exchange (for REST, non-Python)

```bash
curl -s -X POST https://iam.cloud.ibm.com/identity/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=$IBM_CLOUD_API_KEY" | jq -r .access_token
```
Tokens expire (~1h) — re-exchange as needed. The Python SDK does this for you.
