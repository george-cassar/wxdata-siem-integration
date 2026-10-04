# Carbon Design System Skill

A skill that teaches an AI assistant (e.g. **Bob**) to build **IBM Carbon Design System** UIs correctly — pulling official component code, icons, pictograms, design/accessibility docs, and Carbon Charts from the **Carbon MCP** instead of guessing.

> The skill itself is [`SKILL.md`](SKILL.md). This README explains what it is and how to run it.

## Why use it

Carbon's API surface (props, icon names, chart options) changes across versions. The skill makes the assistant **retrieve authoritative, version-correct answers** from the live Carbon MCP rather than relying on memory — so generated code actually compiles against the user's Carbon version.

## What it covers

- **Tool routing** — the core rule: docs → `docs_search`, component code / icons / pictograms / AI Chat code → `code_search`, Carbon Charts → `get_charts` (only).
- Accurate, tested contracts for all **3 server tools**, including their size conventions and follow-up protocols.
- Workflows for building a component, finding an icon, answering a design/a11y question, and building a chart.
- Output rules (never invent props/icon/chart options; cite the doc `anchor_url`).

## Requirements: the Carbon MCP

This skill is the *instructions*; it needs the **Carbon MCP server** to do anything. Configure it with [`carbon-mcp-config.json`](carbon-mcp-config.json):

- **URL:** `https://mcp.carbondesignsystem.com/mcp` (`streamable-http`)
- **Auth headers:** `Authorization: Bearer <token>` and `X-MCP-Session: <session-id>` — replace `YOUR-CARBON-API-HERE` and `YOUR-SESSION-ID-HERE` with your own values.

⚠️ **The bearer token is a short-lived JWT (~2 hours).** When tool calls start failing with auth errors, get a fresh token + session and update the config headers. (See the token caveat in [`SKILL.md`](SKILL.md).)

> 🔒 The token is a personal IBM SSO credential — anyone holding it can read its claims and call the MCP as you. Don't commit it, paste it into chat, or print it in logs.

## Checking the token: `code-decoder`

[`code-decoder`](code-decoder) is a small CLI that decodes a JWT and reports its expiry — handy for confirming whether the Carbon token is still valid before debugging "why won't it connect."

```bash
./code-decoder -f carbon-mcp-api.txt      # decode the token in the api file
./code-decoder "<jwt>"                     # decode a token passed directly
echo "<jwt>" | ./code-decoder              # or from stdin
./code-decoder -f carbon-mcp-api.txt --json   # machine-readable
```

It prints the header, the claims, and a verdict like `✅ VALID — expires in 1h 34m`. Exit codes: `0` valid, `2` expired, `1` no/!invalid token. It only **reads** the token's claims — it does not verify the signature, and needs no secret to do so.

## ⭐ Recommended pairing

The **MCP** gives the assistant the tools; this **skill** gives it the know-how to use them correctly. Install both together for the best experience — the MCP is recommended to have this skill, and this skill needs the MCP.
