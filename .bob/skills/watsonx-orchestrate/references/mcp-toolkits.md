# MCP toolkits & the watsonx Orchestrate MCP servers

Two distinct uses of MCP with wxO:

1. **Registering an MCP server as a wxO toolkit** so its tools become available
   to agents (`orchestrate toolkits add -k mcp` — group is plural in 2.10.0).
2. **Connecting your coding assistant to the wxO MCP servers** (`wxo-docs`,
   `orchestrate-adk`) to author solutions faster.

---

## 1. Register an MCP server as a toolkit

The group is **`toolkits`** (plural). Use `toolkits add` to configure inline, or
`toolkits import -f <spec>` to load a pre-written MCP spec file. `--kind` is
`mcp` (or `python`). A toolkit wraps an MCP server (local stdio package or remote
endpoint) and exposes selected tools.

```bash
# Local stdio MCP server packaged in a directory
orchestrate toolkits add -k mcp \
  -n math_toolkit \
  --description "Factorial tools" \
  --package-root ./mcp_server \
  --language node \
  --command '["node","dist/index.js","--transport","stdio"]' \
  --tools "*"

# Python-packaged MCP server
orchestrate toolkits add -k mcp -n my_toolkit \
  --description "My tools" \
  --package "my-mcp-package" --language python \
  --command "python -m my_mcp_package" --tools "factorial_value,factorial_digits"

# Remote MCP server
orchestrate toolkits add -k mcp -n remote_toolkit \
  --description "Remote tools" \
  --url https://my-mcp.example.com \
  --transport streamable_http \
  --tools "*"

# From a saved MCP spec file
orchestrate toolkits import -f toolkits/math_toolkit.yaml
```

`toolkits add` options: `--kind(-k) mcp|python`, `--name(-n)`, `--description`
(these three required), `--package`, `--package-root`, `--language(-l) node|python`,
`--command`, `--url(-u)`, `--transport streamable_http|sse`, `--tools(-t)` (comma
list or `"*"`), `--app-id(-a)` (repeatable; only `key_value` connections for STDIO
MCP), `--allowed-context` (remote only: `tenant_id`/`agent_id`), `--tier
small|medium|large` (python toolkits).

`--command` accepts a single string or a JSON-style arg array.
**Tool/toolkit names must be snake_case with no spaces.**

Manage toolkits: `orchestrate toolkits list -v`, `... export -n <name> --output …`,
`... remove -n <name>`.

### Attaching a toolkit to an agent
Only `experimental_customer_care` style agents accept `toolkits:` in YAML (plus
the schedulable exception). For standard agents, import the MCP server's tools
and reference them individually under `tools:` instead.

---

## 2. Building an MCP server for tools (typical flow)

A common pattern (e.g. from the IBM tutorials) is to build a small MCP server
with FastMCP, validate it with an MCP client, then import it:

```python
# mcp_server/server.py
from fastmcp import FastMCP
mcp = FastMCP("math")

def _factorial(n: int) -> int:
    r = 1
    for i in range(2, n + 1):
        r *= i
    return r

@mcp.tool()
def factorial_value(n: int) -> int:
    """Return n! for a non-negative integer n."""
    return _factorial(n)

@mcp.tool()
def factorial_digits(n: int) -> int:
    """Return the number of decimal digits in n!."""
    return len(str(_factorial(n)))

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

Validate locally (run the server, connect an MCP client, exercise each tool with
error cases), then:
```bash
orchestrate toolkits add -k mcp -n math_toolkit --description "Factorial tools" \
  --package-root ./mcp_server --language python \
  --command "python server.py" --tools "*"
```
Then add an agent that uses the imported tools and chat-test it.

---

## 3. wxO MCP servers for your coding assistant (accelerator)

IBM publishes MCP servers an AI assistant can call while authoring wxO solutions.

### `watsonx-orchestrate-adk-docs` (remote — documentation search)
```json
{
  "mcpServers": {
    "watsonx-orchestrate-adk-docs": {
      "command": "uvx",
      "args": ["mcp-proxy", "--transport", "streamablehttp",
               "https://developer.watson-orchestrate.ibm.com/mcp"],
      "alwaysAllow": ["search_ibm_watsonx_orchestrate_adk", "query_docs_filesystem_ibm_watsonx_orchestrate_adk"],
      "disabled": false
    }
  }
}
```
Tool: `search_ibm_watsonx_orchestrate_adk` — search the live ADK docs before
authoring agents/tools/toolkits/models/KBs/connections.

### `watsonx-orchestrate-adk` (local — read the active environment)
```json
{
  "mcpServers": {
    "watsonx-orchestrate-adk": {
      "command": "uvx",
      "args": ["--with", "ibm-watsonx-orchestrate==<version>",
               "ibm-watsonx-orchestrate-mcp-server==<version>"],
      "env": { "WXO_MCP_WORKING_DIRECTORY": "/path/to/project" },
      "alwaysAllow": ["list_agents","export_agent","get_tool_template",
        "list_tools","list_toolkits","list_knowledge_bases",
        "check_knowledge_base_status","list_connections","list_voice_configs",
        "list_models","check_version"],
      "disabled": false
    }
  }
}
```
(Match the MCP server version to your installed ADK; set
`WXO_MCP_WORKING_DIRECTORY` to your project root.)

Read-only tools: `list_agents`, `export_agent`, `get_tool_template`,
`list_tools`, `list_toolkits`, `list_knowledge_bases`,
`check_knowledge_base_status`, `list_connections`, `list_voice_configs`,
`list_models`, `check_version`, plus skill fetchers
(`list_available_skills`, `fetch_skill`, `fetch_all_skills`).

### How to use them well
- **Discovery first:** before writing a new tool/agent, call `list_tools` /
  `list_agents` to find reusable tools and candidate collaborators; use
  `get_tool_template` for a correct starting scaffold; use `export_agent` to read
  an existing definition.
- **Docs on demand:** route uncertain ADK questions through 
  `watsonx-orchestrate-adk-docs` rather than guessing flags/fields.
- **Then act with the CLI:** the MCP servers are for read/discovery/docs; perform
  imports, chat-tests, and deploys with the `orchestrate` CLI.

> If these MCP servers are **not** connected in the current session, fall back to
> this skill's references and `orchestrate ... --help`.