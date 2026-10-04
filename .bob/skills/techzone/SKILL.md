---
name: techzone-mcp
description: Provision and manage IBM TechZone environments (watsonx, OpenShift, RHEL, and other IBM Cloud services) through the TechZone MCP server — use to discover environments in the catalog, create reservation requests, retrieve a request's status and credentials, search TechZone docs, and (for admins) manage the platform/collection catalog.
---

# IBM TechZone MCP

This skill drives the **TechZone MCP server** (a single streamable-HTTP server, named `techzone` in the client config) to discover, provision, and inspect IBM TechZone environments, and to search TechZone documentation. An admin tier of tools can also manage the platform/collection catalog.

> The contents of this skill were verified against the live server. If the server's tool set changes, re-list its tools (see [Verifying the live tool set](#verifying-the-live-tool-set)) and update this file.

## When to activate this skill

- A user needs a watsonx, OpenShift, RHEL, or other IBM Cloud environment for a demo, lab, test, or PoC.
- You need to find an environment in the TechZone catalog and get the ID required to provision it.
- You need to create a TechZone reservation/request with a specific start time, purpose, or geography.
- You need to check the status of a request you already created, or pull its credentials/endpoints once it is Ready.
- You need to search TechZone documentation for setup/automation guidance.
- (Admin) You need to inspect or edit the platform/collection catalog itself.

## Connection and authentication

- **Transport:** `streamable-http` to the server URL in `techzone-mcp-config.json`.
- **Gateway auth:** every request carries the `TechZone-Token: <API key>` header. The MCP client injects this from the config; you do not set it per call.
- **Per-tool auth:** most tools also take a `bearerToken` **argument**. Pass the **same TechZone API key** as that argument. (`search-environments` is the exception — it takes no `bearerToken`.)
- The key lives in `techzone-key.txt` for local testing. **Never paste the full key into chat, logs, commits, or tool transcripts** — treat it as a secret (see [Handling secrets](#handling-secrets)).

In Bob the tools are exposed with the server prefix, e.g. `mcp__techzone__request-mcp-search-environments`. This document refers to them by their server-side names (`request-mcp-search-environments`, etc.).

## Tool reference (14 tools)

The server groups tools into four namespaces. **Read paths are safe; write/delete paths (`*-create`, `*-update`, `*-delete`) mutate the shared catalog — see [Admin / write tools](#admin--write-tools-handle-with-care).**

### Discovery — `request-mcp` and `documentation-mcp`

#### `request-mcp-search-environments`
Full-text search of the bookable environment catalog (Milvus collection `certified_base_images`).
- **Args:** `query` (text, case-insensitive over name/description), `limit` (1–100, default 10), `filter` (optional Milvus boolean expr), `outputFields` (optional).
- **No `bearerToken` argument.**
- **You must supply a `query` and/or `filter`** — an empty call errors with *"No valid search expression could be built."*
- **Returns:** `{ collection, count, results: [...] }`. Each result has `name`, `description`, **`environment_id`**, `infrastructure`, `id` (catalog index), `score`, `customScore`.
- **Key fact:** the value you pass to `techzone-create-request` as `platformId` is the result's **`environment_id`** (a 24-char hex id), *not* the small `id`.

#### `documentation-mcp-techzone-search-content-docs`
Full-text search of TechZone documentation (collection `itz_content_docs`).
- **Args:** `bearerToken` (required), `query`, `limit` (1–100, default 10), `filter`, `outputFields`.
- **Returns:** records with `title`, `section`, `content`, `score`. Use for setup, automation/post-deploy, and capability questions.

### Provisioning & status — `request-mcp`

#### `request-mcp-techzone-create-request`
Creates a reservation. Performs the **entire** policy workflow server-side in one call: resolves the user from the token, fetches platform metadata + regions, reads roles, verifies **all** policies (Duration, Quota, Circuit Breaker, Provisioner), computes the end date, and creates the request.
- **Args:**
  - `platformId` (required) — the `environment_id` from `search-environments`.
  - `start` (required) — ISO 8601 **UTC**, must end in `Z` (e.g. `2026-06-12T06:00:00Z`). There is **no timezone tool on this server**; convert local→UTC yourself before calling (see [Time handling](#time-handling-no-server-side-converter)).
  - `bearerToken` (required) — the TechZone API key.
  - `purpose` (optional) — one of `Demo`, `Education`, `Event`, `Pilot`, `Test`. Default `Test`.
  - `geography` (optional) — fuzzy-matched against the platform's region `geo` values. Observed values: `americas`, `europe`, `ap` (Asia-Pacific). If omitted/unmatched, a random available region is chosen.
  - `opportunity` (optional) — **required when `purpose` is `Demo` or `Pilot`** (CRM opportunity code).
- **Returns:** the created request (capture the request `id` — you will need it; the server has no "list my requests" tool).

#### `request-mcp-techzone-get-request`
Retrieves one request by id: status, platform info, schedule (start/end), region, owner, metadata, and — once provisioned — credentials/endpoints.
- **Args:** `requestId` (required, 24-char hex), `bearerToken` (required).
- **This is the only way to check a request's status and to pull its credentials.** Call it after provisioning completes.
- **404 shape:** `Failed to fetch request <id>: TechZone API error 404: {"error":"Not found"}` → the id is wrong or not owned by this token.

### Catalog inspection — `platform-mcp` / `collection-mcp` (read)

#### `platform-mcp-platform-get`
Full platform document by id: `regions[]` (each with `region`, `geo`, `datacenter`, `status`, automation `template`, `variables`, `pattern`), `infrastructure`, `collection`, `automation`, runtime limits (`idleRuntimeLimit`, `totalRuntimeLimit`, `timeoutAction`), `access`, etc.
- **Args:** `bearerToken` (required), `id` (required).
- ⚠️ **This payload is very large** (full region/automation/collection trees). Prefer `platform-list` with a `fields` projection when you only need a few attributes; reach for `platform-get` only when you genuinely need region/automation detail.

#### `platform-mcp-platform-list`
Search/filter platform records.
- **Args:** `bearerToken` (required), `where` (JSON **string**, e.g. `'{"status":"Active"}'`), `limit`, `skip`, `sort` (e.g. `"name ASC"`), `fields` (array — **use this to slim the response**, e.g. `["id","name","status"]`).
- **Returns:** array of platform docs. Empty `where` returns all platforms (many are `Disabled`).

#### `collection-mcp-collection-get` / `collection-mcp-collection-list`
Collections group platforms/journeys into curated catalog entries (e.g. "Certified watsonx").
- `collection-get`: `bearerToken`, `id`.
- `collection-list`: `bearerToken`, `where` (JSON string), `limit`, `skip`, `sort`, `fields`.

### Admin / write tools — handle with care

These mutate the **shared** TechZone catalog and are **not** part of normal provisioning. They are intentionally **excluded from the config's `alwaysAllow` list** — each will prompt. Use only on explicit, specific admin instruction, and confirm the target id first.

- `platform-mcp-platform-create` — `bearerToken`, `data` (object).
- `platform-mcp-platform-update` — `bearerToken`, `id`, `data` (only provided fields change).
- `platform-mcp-platform-delete` — `bearerToken`, `id`. **Irreversible.**
- `collection-mcp-collection-create` — `bearerToken`, `data`.
- `collection-mcp-collection-update` — `bearerToken`, `id`, `data`.
- `collection-mcp-collection-delete` — `bearerToken`, `id`. **Irreversible.**

**Never** call a `*-delete` or `*-update` to "clean up" or "fix" something on your own initiative. Confirm with the user, echo the exact id and name, and proceed only on explicit go-ahead.

## Known limitations (important)

These shape every workflow — do not assume the missing capabilities exist:

1. **No "list my requests" tool.** You cannot enumerate a user's reservations through MCP. The **only** way back to a request is its `requestId` (from the `create-request` response, or from the TechZone UI at `https://techzone.ibm.com`). **Always record the `requestId` you get from `create-request` and give it to the user.**
2. **No timezone/clock tools.** There is no `convert-timezone`, `get-current-time`, or `calculate-request-schedule`. Compute UTC yourself and let the server compute the end date.
3. **No standalone policy tools.** There is no `verify-policies`/`get-policy`. `create-request` runs all policy checks internally; if it fails it tells you which policy blocked it.
4. **`search-environments` needs a query.** It will not "return everything" on an empty call.

## Core workflows

### A. Find and provision an environment
1. `request-mcp-search-environments` with a focused `query` (e.g. `"watsonx assistant"`, `"openshift"`, `"RHEL"`). For project reuse, prefer results whose **name contains "Student ID"** (single student account, simpler credentials).
2. Present the top results: `name`, a one-line description, and the **`environment_id`**. Let the user choose.
3. (Optional) If the user cares about region/automation detail, `platform-mcp-platform-get` on that `environment_id`.
4. Determine `start` in **UTC** (convert from the user's local time yourself; default to "now" if they say "start now").
5. `request-mcp-techzone-create-request` with `platformId=<environment_id>`, `start`, `bearerToken`, plus `purpose`/`geography` as appropriate. Supply `opportunity` if `purpose` is `Demo`/`Pilot`.
6. **Record and return the `requestId`** and the tracking URL `https://techzone.ibm.com/my/requests/<requestId>`. Set the expectation that provisioning typically takes ~10–15 minutes.

### B. Check status / retrieve credentials
1. `request-mcp-techzone-get-request` with the saved `requestId`.
2. If status is not yet Ready, report the current status and that it is still provisioning — there is nothing to poll but this same call. Re-check after a few minutes.
3. When Ready, extract credentials/endpoints and present them grouped (API keys, usernames/passwords, endpoints, access URLs), **masking secrets** (see below).

### C. Browse the catalog (admin/inspection)
- Use `platform-mcp-platform-list` (with `fields` + `where`) and `collection-mcp-collection-list` to inspect what exists. Reach for the `*-get` variants only when you need the full document.

### D. Documentation lookup
- `documentation-mcp-techzone-search-content-docs` with a targeted query for setup, automation, or capability questions.

## Time handling (no server-side converter)

The server expects `start` as ISO 8601 UTC ending in `Z`, and there is no conversion tool. Do the math yourself:
- "Start now" → use the current UTC time (a minute or two in the future is fine).
- Local → UTC: apply the user's offset, accounting for DST. Examples: `00:00 America/Chicago` (CDT, −5) = `05:00:00Z` the same date; `09:00 Europe/Bucharest` (EEST, +3) = `06:00:00Z`.
- State the UTC value you derived back to the user so they can sanity-check it.

The server computes the **end** time from policy duration limits; you only supply `start`.

## Response formatting rules

- When showing search results, include `name` and the **`environment_id`** (that is the provisioning id), and flag any **"Student ID"** environment as *recommended for project reuse*.
- After `create-request`, always surface the **`requestId`** and the tracking URL — it is the user's only handle on the reservation.
- Set time expectations honestly: provisioning is typically ~10–15 min; some platforms take longer.
- For geography, map the user's location to a `geo`: Europe→`europe`, US/Canada/LatAm→`americas`, Asia-Pacific→`ap`.
- For credentials, group by API Keys / Usernames & Passwords / Endpoints / Access URLs.

## Handling secrets

- **API key (`TechZone-Token` / `bearerToken`):** never print it in full. The config and `techzone-key.txt` hold it; refer to it, don't echo it.
- **Retrieved credentials:** when showing an API key or password from `get-request`, mask the middle — show the first ~8 and last ~6 characters only (e.g. `CdxY1-04…jcx88l`). Provide the full secret to the user only through the channel they ask for, and never write it into committed files or logs.
- Don't fetch credentials "just in case" — only call `get-request` for credentials when the user needs them and the request is Ready.

## Error handling

| Symptom | Likely cause | What to do |
|---|---|---|
| `No valid search expression could be built` | `search-environments` called with no `query`/`filter` | Supply a `query`. |
| `... TechZone API error 404: {"error":"Not found"}` from `get-request` | Wrong `requestId`, or it belongs to a different user/token | Re-confirm the id you saved from `create-request`; check the TechZone UI. |
| `create-request` fails citing a policy (Duration/Quota/Circuit Breaker/Provisioner) | Token's user isn't eligible, over quota, or platform is rate-limited | Report which policy blocked it; suggest a different platform/purpose, or wait and retry. |
| Auth/401-style failure | Key wrong/expired, or `bearerToken` arg missing on a tool that needs it | Confirm the key; ensure you passed it as `bearerToken` for every tool except `search-environments`. |
| `create-request` rejects `start` | Not UTC / in the past / missing `Z` | Recompute UTC; ensure the string ends in `Z` and is in the future. |
| Need `opportunity` | `purpose` is `Demo` or `Pilot` | Ask the user for the CRM opportunity code. |

## Quick reference

| Tool | Purpose | Auth arg | Notes |
|---|---|---|---|
| `request-mcp-search-environments` | Find bookable environments | none | needs `query`; use `environment_id` to provision |
| `request-mcp-techzone-create-request` | Create a reservation | `bearerToken` | `start` must be UTC `Z`; save the returned `requestId` |
| `request-mcp-techzone-get-request` | Status + credentials | `bearerToken` | only handle on a request; no list tool exists |
| `documentation-mcp-techzone-search-content-docs` | Search docs | `bearerToken` | collection `itz_content_docs` |
| `platform-mcp-platform-list` | Inspect platforms | `bearerToken` | use `fields`/`where` to slim |
| `platform-mcp-platform-get` | Full platform doc | `bearerToken` |  very large payload |
| `collection-mcp-collection-list` / `-get` | Inspect collections | `bearerToken` | curated catalog groupings |
| `platform-mcp-platform-create/update/delete` | **Edit catalog** | `bearerToken` | admin-only; confirm; delete is irreversible |
| `collection-mcp-collection-create/update/delete` | **Edit catalog** | `bearerToken` | admin-only; confirm; delete is irreversible |

## Verifying the live tool set

If behavior diverges from this doc, re-list the server's tools and re-check. Using the config URL and key:

```bash
KEY=$(cat techzone-key.txt | tr -d '\n')
URL="<url from techzone-mcp-config.json>"
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "TechZone-Token: $KEY")
JAR=$(mktemp)
curl -s -c "$JAR" -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cc","version":"1.0"}}}' >/dev/null
curl -s -b "$JAR" -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
curl -s -b "$JAR" -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | sed 's/^data: //'
```

A `tools/call` uses `{"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`.

## Integration after provisioning (optional)

Once `get-request` yields IBM Cloud credentials you can drive the IBM Cloud CLI, e.g.:

```bash
ibmcloud login --apikey "<API_KEY>" -r eu-gb     # region matches the provisioned geo
ibmcloud resource service-instances              # list provisioned services
```

For watsonx/Watson Studio, sign in to the regional Data Platform URL from the request (e.g. `https://eu-gb.dataplatform.cloud.ibm.com`) with the returned username/password, then create/associate a project. Keep secrets out of shell history and committed files.
