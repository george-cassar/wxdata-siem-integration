---
name: carbon-mcp
description: Build IBM Carbon Design System UIs correctly — use the Carbon MCP to look up official component code (React/Web Components), icons & pictograms, design/usage/accessibility documentation, and Carbon Charts source. Activate whenever generating or reviewing Carbon UI code, choosing a Carbon component, finding a Carbon icon, answering a Carbon design/usage/a11y question, or building a Carbon chart.
---

# IBM Carbon Design System MCP

This skill drives the **Carbon MCP server** (`carbon-mcp`, vendor *IBM Carbon Design System*) to retrieve **authoritative, version-correct** Carbon information instead of relying on memory. Carbon's API surface changes across versions; always retrieve from the MCP rather than guessing component props, icon names, or chart options.

> Verified against `carbon-mcp` v1.10.0. If behavior diverges, re-list the tools (see [Verifying the live tool set](#verifying-the-live-tool-set)) and update this file.

## When to activate

- Generating or reviewing **Carbon UI code** (React or Web Components).
- Choosing a Carbon **component** and needing its real props, variants, and example code.
- Finding a Carbon **icon or pictogram** (correct name, import statement, sizes, SVG).
- Answering a Carbon **design / usage / style / accessibility** question.
- Building a **Carbon chart** (`@carbon/charts`).
- Working with **IBM Products** (Carbon for IBM Products) or **Carbon AI Chat** examples.

## Connection and authentication

- **Transport:** `streamable-http` to `https://mcp.carbondesignsystem.com/mcp` (exact URL in `carbon-mcp-config.json`).
- **Auth headers** (both required, injected by the MCP client from the config):
  - `Authorization: Bearer <token>`
  - `X-MCP-Session: <session-id>`
- ⚠️ **The bearer token is a short-lived JWT (~2 hours).** When calls start failing with auth errors, the token has expired — obtain a fresh token (and session id) and update the config headers (replace `YOUR-CARBON-API-HERE` / `YOUR-SESSION-ID-HERE`). Treat the token as a secret: never print it, commit it, or paste it into chat.

In Bob the tools appear as `mcp__carbon-mcp__<tool>`. This doc refers to them by their server names: `docs_search`, `code_search`, `get_charts`.

## Tool routing — pick the right tool first

This is the most important rule. Each tool owns a distinct domain:

| You need… | Use | Never use |
|---|---|---|
| Design, usage, style, accessibility, general guidance | **`docs_search`** | — |
| Component **code** (React/Web Components), **icons**, **pictograms**, **AI Chat example code** | **`code_search`** | — |
| **Carbon Charts** code, options, or TypeScript interfaces | **`get_charts`** | ❌ `code_search`, ❌ `docs_search` |

**Hard rule:** for anything `@carbon/charts`, `get_charts` is the *only* authoritative tool. Do not `code_search` for charts, and do not `docs_search` for chart TypeScript interfaces.

## Tools

### `docs_search` — documentation
Searches Carbon + IBM Products documentation for design, usage, style, accessibility, and general content.

- **Args:** `query` (**required**, full-text), `size` (default 3), `filters`.
- **`filters`:** `component_id`, `topic_id`, `page_type` (e.g. `accessibility`, `usage`, `style`), `site_area`, `ibm_products`.
- **Size guidance:** doc chunks are small and sparse — **keep `size` ≥ 3** to get past intro chunks to a substantive answer.
- **Component docs:** you MAY filter by `component_id` and `page_type`.
- **AI Chat docs:** **do NOT use component filters**; query by API, symbol, or topic name.
- **Returns:** ranked chunks with `source.page_url`, `source.anchor_url` (deep link to the section), `chunk_text`, `section_heading`, `page_type`, `component_id`. **Cite the `anchor_url`** in your answer.
- **Unsupported (do not send):** `from`, `sort`, `debug`.

### `code_search` — components, icons, pictograms, AI Chat code
Searches Carbon React/Web Components code examples, icons, pictograms, and AI Chat example code.

- **Args:** `query` (**required**), `size` (default 2), `filters`.
- **`filters`:** `component_type` (`React` | `Web Components`), `component_id`, `variant_id`, `ibm_products` (`yes` | `no`), `asset_type` (`icon` | `pictogram`).
  - Set `component_type` **only for components**; **omit it for icons/pictograms** (use `asset_type` instead).
- **Query well:** use **specific component/icon names**; avoid generic terms like "example" or "implementation".
- **Size conventions (follow exactly):**
  - Targeted component or icon query → **`size: 2`**.
  - AI Chat *full* example → **`size: 15`** (needed to surface all files); include **"ai chat" + the framework** in the query.
  - `requery_hint` follow-ups and recovering one specific AI Chat file → **`size: 1`**.
- **Follow-up protocol (important):**
  - If a variant has **`example_omitted: true`**, re-call using its **`requery_hint`** with **`size: 1`** — do **not** just increase size.
  - If the response has **`meta.follow_up_required: true`**, re-call with one entry from **`meta.follow_up_calls`** before finalizing.
- **Returns:**
  - *Components:* `variants[]` with `variant_id`, `example_clean` (ready code), `props_used`/`props_not_used`, `capabilities`, `storybook_url`.
  - *Icons/pictograms:* `name`, `package` (e.g. `@carbon/icons-react`), `import_stmt`, `example`, `usage[]` (size variants), and raw `sizes[].code` SVG.
- **Unsupported:** `from`, `sort`, `debug`.

### `get_charts` — Carbon Charts
Retrieves Carbon Charts source code, options, and TypeScript interfaces, ready for code generation.

- **Input contract:** provide **(`framework` + `chart_type`)** OR `doc_id` OR `rag_id`.
  - **`framework`:** `react`, `angular`, `vue`, `svelte`, `vanilla`, `html`.
  - **`chart_type`** (slug): `bar` (use for bar **and** column), `line`, `pie`, `donut`, `area`, `scatter`, `bubble`, `combo`, `radar`, `treemap`, `heatmap`, `gauge`, `meter`.
  - **`variant`:** optional; omit for the simplest default, then inspect `available_variants` to discover others (e.g. `grouped`, `stacked`, `simple`, `horizontal`).
  - **`data`:** optional CSV string; **`options`:** optional object to merge on top.
- **2-call convention (use this):**
  1. `mode: 'schema'` → returns `available_variants`, data field names, and options shape only (cheap; discover what the chart expects).
  2. `mode: 'full'` (+ chosen `variant`) → returns complete source. **Use these assembly fields verbatim:**
     - **`assembly.install_command`** → run in the terminal.
     - **`assembly.styles_import`** → add as a **top-level import in the app entry module**. **Never** place in SCSS or convert to `@use`/`@import`.
     - **`chosen_variant.import_hint`** → the component import statement.
     - **`chosen_variant.usage_hint`** → the usage template; substitute the user's data/options.
- **TypeScript interfaces (don't use `docs_search`):**
  - For options/config questions: `include_interfaces: true` → returns `interface_doc` with definition + `referenced_types`.
  - Then call `interface_names: [...referenced_types]` → returns `interface_docs` plus `follow_up_interface_names`; keep calling with those values **until `follow_up_interface_names` is absent**.

## Workflows

### Build a component (React/Web Components)
1. `code_search` with the specific component name, `component_type`, and `component_id`, `size: 2`.
2. If the best variant shows `example_omitted: true`, follow its `requery_hint` with `size: 1`. If `meta.follow_up_required`, run one `meta.follow_up_calls` entry.
3. Use `example_clean` and the real `props_used` to generate code. If the user asks about behavior/a11y, also run `docs_search` (`page_type: accessibility`) and cite the `anchor_url`.

### Find an icon or pictogram
1. `code_search` with the icon name + `asset_type: "icon"` (or `"pictogram"`), `size: 2`. **Omit `component_type`.**
2. Use the returned `import_stmt` / `example` and the exact `name` and `package` — don't invent icon names.

### Answer a design / usage / accessibility question
1. `docs_search` with a focused `query`, `size: 3+`, and `filters` (`component_id`, `page_type`).
2. Summarize the `chunk_text` and **link the `anchor_url`** so the user can read the source section.

### Build a Carbon chart
1. `get_charts` with `framework` + `chart_type`, `mode: 'schema'` → pick a `variant`, learn the data/options shape.
2. `get_charts` again `mode: 'full'` + chosen `variant` (pass `data`/`options` if the user supplied them).
3. Assemble using `assembly.install_command`, `assembly.styles_import` (entry module, top-level), `chosen_variant.import_hint`, `chosen_variant.usage_hint`.
4. For deeper option questions, chain `include_interfaces` → `interface_names` until `follow_up_interface_names` is absent.

### Carbon AI Chat
- *Docs:* `docs_search` **without** component filters; query by API/symbol/topic.
- *Example code:* `code_search` with **"ai chat" + framework** in the query and **`size: 15`**; recover a single named file with `size: 1`.

## Output and citation rules

- Generate code only from retrieved `example_clean` / chart assembly fields and real prop/option names — **never invent props, icon names, or chart options**. If retrieval is empty, say so and refine the query rather than guessing.
- Prefer the user's stated `component_type`/framework; if unspecified for components, default to **React**.
- When answering design/usage/a11y questions, cite the doc **`anchor_url`**.
- Note the Carbon version when the result carries one (e.g. icon results reference a `carbon/v11.x` tag; components return `version`).
- For charts, follow the assembly rules exactly — especially keeping `styles_import` as a top-level JS/TS import, not SCSS.

## Error handling

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 / auth failure on every call | Bearer JWT expired (~2h lifetime) or session missing | Get a fresh token + session id; update `Authorization` / `X-MCP-Session` in the config |
| `Method not found` for `prompts/list` or `resources/list` | Server only implements tools | Use the 3 tools; it has no prompts/resources |
| Empty/intro-only `docs_search` results | `size` too small | Raise `size` to ≥ 3; add `component_id`/`page_type` filters |
| Variant code missing (`example_omitted: true`) | Server condensed the payload | Re-call with the variant's `requery_hint`, `size: 1` |
| Incomplete AI Chat example | `size` too small | Use `size: 15` with "ai chat" + framework in the query |
| Charts results look wrong via `code_search` | Wrong tool | Charts come **only** from `get_charts` |
| Asked for an option that isn't in the example | Need the interface | `get_charts` `include_interfaces: true`, then chain `interface_names` |

## Verifying the live tool set

```bash
TOKEN="<bearer-from-config>"; SESSION="<session-from-config>"
URL="https://mcp.carbondesignsystem.com/mcp"
H=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
   -H "Authorization: Bearer $TOKEN" -H "X-MCP-Session: $SESSION")
curl -s -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cc","version":"1.0"}}}' >/dev/null
curl -s -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
curl -s -X POST "$URL" "${H[@]}" -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | sed 's/^data: //'
```

A `tools/call` uses `{"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}`.
