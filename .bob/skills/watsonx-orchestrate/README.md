# IBM Bob - Watsonx Orchestrate (skill)

A Bob skill for building, testing, debugging, and publishing
**IBM watsonx Orchestrate** agents, tools, flows, MCP toolkits, connections, models,
and knowledge bases with the **Agent Development Kit (ADK)** and the `orchestrate` CLI.

Covers the full lifecycle: connect (SaaS / on-prem / local Developer Edition) → scaffold
→ author tools/flows/agents → import (dependency-ordered) → single/multi-turn chat test
→ export/reimport → observability → deploy. Also covers multi-agent orchestration,
AgentOps evaluations, chat-with-docs, embedded web chat, and the runtime REST API for
embedding a deployed agent in your own app.

## Built & verified for

- **ADK: `ibm-watsonx-orchestrate` 2.18.0** (Python 3.11–3.14)
- **Live-verified:** 2026-10-01 against a real IBM Cloud SaaS instance (us-south). A
  Princeton-Plainsboro hospital (a `dr_house` orchestrator, five specialists, an external
  collaborator, a scripted agent skill, and three flows) was imported, deployed and tested,
  including single-turn and multi-turn runs against the **live** version. Evidence:
  `test/house_hospital/results/TEST_REPORT.md`.
- **2.16 → 2.18 coverage:** tool shortlisting (proved to work **only via v2 chat
  completions**: −59 % input tokens), user activity nodes (driven end to end over the API),
  text extractor `output_content_types`, classifier `page_range`, `error_handler_config`,
  agent-node `thread_control_policy`, agent skills with `scripts/` + `references/`, Gemma 4 31B,
  agent versioning (release / switch / undeploy / delete over REST), external agents as
  collaborators, `custom_agents_metadata`, Azure auth modes, JWT Bearer connections,
  `--iam-url`.
- **Corrections the release notes don't mention:** runtime APIs run the **draft** unless you
  target `live` (`wxo-chat.sh --live`); collaborator tool names are now **display-name
  slugs**; skill scripts need a **`run`** entry function; `agents export` **fails for agents
  with skills**; deleting the live version **silently undeploys**; `custom_agents_metadata` is
  **dropped for external agents**; `--iam-url` is on `env add` only (hidden); Azure auth
  fields belong to `azure-ai`, not `azure-openai`.
- **Reversed since 2.15:** `run.usage` is populated, and the 100-char `welcome_message` cap
  is gone.
- **2.15.0 coverage:** `orchestrate controls` (policy artifacts bound to agents/tools/
  models at execution hooks — **proved to enforce at runtime**), multiple knowledge bases
  per agent, `welcome_content.is_user_barge_in_disabled`, voice idle-handler fields,
  `connections configure --name`, Deepgram Flux STT.
- **2.14.0 coverage:** `language=` on document-processing nodes, the 30-class classifier
  cap, Google TTS and Deepgram `normalize_volume`, `on_flow_abort` / `on_flow_delete`,
  optional KB `index_config.url`, `redhat-ai` and `msftstudio` providers, and observability
  export for agents running outside wxO (OpenTelemetry / Observability SDK).
- **Two release-note enum names are corrected here**: the model provider is **`redhat-ai`**
  (not `red_hat_ai`) and the external-agent provider is **`msftstudio`** (not
  `microsoft_copilot_studio`).
- **2.13.0 coverage (retained):** agent **skills** (`orchestrate skills`, agent `skills:`
  field), `react_core` default style (default/react/planner deprecated), premier models
  (GPT-5.4), traces observations + `--last`, flow `suppress_agent_summarization` /
  `page_range`.

> The ADK moves fast - when a flag or field is uncertain, prefer
> `orchestrate <group> --help`. Re-run `test/house_hospital/` (`import-all.sh`, deploy,
> `results/TEST_REPORT.md`) to re-verify after an ADK bump.

## Contents

- `SKILL.md` — the skill (lifecycle, schemas, constraints, debugging, publishing).
- `references/` — load-on-demand deep dives: CLI reference, agent/tool/flow schemas,
  connections/models/KB, MCP toolkits, runtime-API embedding, testing & debugging,
  AgentOps evaluations, plus `setup-venv.sh` and `wxo-chat.sh` helper scripts.
