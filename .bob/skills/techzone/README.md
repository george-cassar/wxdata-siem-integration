# TechZone Skill

A skill that teaches **IBM Bob** how to use the **TechZone MCP** correctly and safely — so users can onboard to IBM Technology Zone and find, provision, and manage environments through natural conversation.

> The skill itself lives in [`../SKILL.md`](../SKILL.md). This README explains what it is and how to use it.

## About IBM Technology Zone

IBM Technology Zone is the single destination for IBM go-to-market teams and the IBM Business Partner ecosystem to access on-demand and live environments to **learn, build, show, and share** the value of IBM solutions, and to extend IBM's certified base images for **test, education, demonstration, and pilot** activities.

## What this skill adds

The MCP exposes the *tools*; this skill supplies the *operating knowledge* the assistant needs to use them well:

- **Right tool, right name** — the actual 14-tool set, verified against the live server (no invented tools).
- **Right IDs** — provision with an environment's `environment_id`, not its display index.
- **Ready-made workflows** — find → provision → check status → retrieve credentials.
- **UTC time handling** — the server has no timezone tool, so the skill explains converting local start times to UTC.
- **Secret safety** — masking API keys/passwords, never echoing the token.
- **Known limitations** — e.g. there's no "list my requests" tool, so always save the `requestId`.
- **Error recovery** — maps the server's real error strings to fixes.

## Activation

The skill auto-activates when a user asks to find, provision, check, or pull credentials for an IBM TechZone / watsonx / OpenShift / RHEL environment. Install it where your assistant loads skills (drop `SKILL.md` into your skills directory or plugin).

## ⭐ Recommended: install the TechZone MCP alongside this skill

This skill is the *instructions*; it needs the **TechZone MCP** to actually *do* anything — every workflow here calls MCP tools. **Install both together.** See the MCP setup in [`../README.md`](../README.md).

In short: the **MCP is recommended to have this skill** (so the assistant uses it correctly), and this **skill is recommended to have the MCP** (so it has tools to drive). They're designed to work as a pair.
