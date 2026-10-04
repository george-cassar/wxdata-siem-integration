# IBM watsonx.ai Skill

A skill that teaches an AI assistant (e.g. **Bob**) to build on **IBM watsonx.ai**
correctly — running foundation models, embeddings, and RAG, tuning models, and
storing/deploying/scoring models — using the official `ibm-watsonx-ai` Python SDK
and the watsonx.ai Runtime REST API, grounded in the real API surface rather than
guesswork.

## What it covers

- **Connect** — `Credentials`/`APIClient`, IBM Cloud vs Cloud Pak for Data, regions,
  and the mandatory project-vs-space scope.
- **Inference & chat** — `ModelInference` (generate, chat, streaming, tokenize),
  decoding params, tools/function-calling, guardrails.
- **Embeddings & RAG** — `Embeddings` plus the `extensions.rag` toolkit
  (vector stores, chunkers, retrievers).
- **Tuning** — prompt tuning, fine-tuning, InstructLab, AutoAI.
- **Classic ML lifecycle** — store → deploy (online/batch) → score, and batch jobs.
- **REST API** — generative `/ml/v1/text/*` and lifecycle `/ml/v4/*`, with auth and
  versioning.

## Layout

```
ibm-watsonx.ai/
├── SKILL.md              # the skill (the assistant loads this)
├── README.md             # this file
└── references/           # loaded on demand by the skill
    ├── setup-auth.md
    ├── inference-chat.md
    ├── embeddings-rag.md
    ├── tuning.md
    └── classic-ml-and-rest.md
```

## Grounding & versions

Verified against **`ibm-watsonx-ai` 1.5.x** (SDK docs snapshot v1.5.11) and the
watsonx.ai Runtime REST spec. The SDK changes fast, so the skill's golden rule is
to **verify signatures against the live docs / `help()`** and **list model ids from
the live service** rather than trusting any hardcoded list — model ids deprecate on
a published lifecycle.

> 🔒 watsonx.ai credentials (IBM Cloud API key / IAM token) are secrets — read them
> from environment variables, never hardcode or commit them.

## Related skills

watsonx.ai is the **model layer** other IBM products build on. Pair it with the
**watsonx Orchestrate** skill when wiring a watsonx.ai model into an agent, and with
the **TechZone** skill when you need to provision a watsonx.ai environment first.
