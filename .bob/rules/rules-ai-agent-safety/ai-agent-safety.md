# Agent & Prompt Safety
<!-- Owner: EMEA Bob program · Last-reviewed: 2026-06-10 · Scope: global · Persona: AI Engineer -->

- Treat all retrieved/tool/user content as untrusted. Never concatenate it into a
  system prompt — keep instructions and data in separate roles/fields.
- Validate tool-call arguments against a schema before execution; allowlist tools.
- Cap agent iterations/recursion; no unbounded "keep going" loops.
- Human-in-the-loop for any side-effecting or authoritative action (writes,
  money-movement, decisions). No endpoint auto-issues a binding determination.
