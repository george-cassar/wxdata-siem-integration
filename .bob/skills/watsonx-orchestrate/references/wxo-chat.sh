#!/usr/bin/env bash
# wxo-chat.sh — Programmatic single-turn and multi-turn chat with a watsonx Orchestrate agent
#
# Reads credentials and the active environment from the Developer Edition config at:
#   ~/.config/orchestrate/config.yaml     (active env, wxo_url)
#   ~/.cache/orchestrate/credentials.yaml (wxo_mcsp_token)
#
# Usage:
#   Single-turn (new thread):
#     ./wxo-chat.sh -n <agent-name> "Your message"
#
#   Multi-turn (continue existing thread):
#     ./wxo-chat.sh -n <agent-name> --thread-id <UUID> "Your follow-up"
#
#   With reasoning trace:
#     ./wxo-chat.sh -n <agent-name> -r "Your message"
#
#   Override active environment:
#     ./wxo-chat.sh -n <agent-name> -e local "Your message"
#
#   Test the DEPLOYED (live) version instead of the draft (ADK 2.17+ agent versioning):
#     ./wxo-chat.sh -n <agent-name> --live "Your message"
#   Without --live the runs API targets the agent's DRAFT (live-verified 2.18.0) —
#   so a default test proves the draft works, not what users of the deployed agent get.
#
# Output (JSON, always to stdout):
#   {
#     "status":          "success" | "error",
#     "thread_id":       "<UUID>",
#     "final_message":   "...",
#     "reasoning_trace": { "steps": [...] },
#     "thinking_trace":  ["..."],
#     "error":           null
#   }
#
# thread_id: save this value and pass it back via --thread-id to continue
#            the conversation from any process at any point in time.
#
# Dependencies: curl, python3 (system — no third-party packages required)

set -euo pipefail

# ─── Helpers ────────────────────────────────────────────────────────────────────

usage() {
  grep '^#' "$0" | sed 's/^# \?//'
  exit 0
}

die() {
  >&2 echo "ERROR: $*"
  exit 1
}

# Temp-file cleanup on exit
_TMPDIR=""
cleanup() {
  [[ -n "$_TMPDIR" ]] && rm -rf "$_TMPDIR"
}
trap cleanup EXIT
_TMPDIR=$(mktemp -d)

# ─── Lightweight YAML scalar reader (no PyYAML required) ────────────────────────
# Walks simple key: value / nested-section YAML files without any import.
# Supports up to 3-level nesting (all we need here).
#
# Usage: yaml_scalar FILE KEY [SECTION_KEY ...] LEAF_KEY

yaml_scalar() {
  local file="$1"; shift
  python3 - "$file" "$@" <<'PYEOF'
import sys, re

file = sys.argv[1]
keys = sys.argv[2:]

with open(file) as fh:
    lines = fh.readlines()

def get_nested(lines, key_path):
    depth = 0
    idx   = 0
    for key in key_path:
        target_indent = depth * 2
        found = False
        while idx < len(lines):
            raw     = lines[idx]
            stripped = raw.rstrip()
            idx += 1
            if not stripped or stripped.lstrip().startswith('#'):
                continue
            indent = len(raw) - len(raw.lstrip(' '))
            if indent < target_indent:
                return None          # overshot — key absent at this level
            if indent != target_indent:
                continue
            m = re.match(r'\s*([^:]+):\s*(.*)', stripped)
            if not m:
                continue
            k = m.group(1).strip()
            v = m.group(2).strip()
            if k != key:
                continue
            # Key matched
            if depth == len(key_path) - 1:
                # Leaf: return scalar or None for empty/null
                return v.strip("'\"") if v and v not in ('null', '~') else None
            else:
                # Section: descend one level
                depth += 1
                found = True
                break
        if not found:
            return None
    return None

result = get_nested(lines, keys)
print(result if result is not None else "")
PYEOF
}

# ─── Config paths ────────────────────────────────────────────────────────────────

CONFIG_FILE="${HOME}/.config/orchestrate/config.yaml"
CREDS_FILE="${HOME}/.cache/orchestrate/credentials.yaml"

[[ -f "$CONFIG_FILE" ]] || die "Config not found: ${CONFIG_FILE}. Run: orchestrate env activate"
[[ -f "$CREDS_FILE" ]]  || die "Credentials not found: ${CREDS_FILE}. Run: orchestrate env activate"

# ─── Parse arguments ─────────────────────────────────────────────────────────────

AGENT_NAME=""
THREAD_ID=""
ENVIRONMENT=""
INCLUDE_REASONING=false
TARGET_LIVE=false
POLL_INTERVAL=2
POLL_TIMEOUT=300
MESSAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--agent-name)    AGENT_NAME="$2";    shift 2 ;;
    --thread-id)        THREAD_ID="$2";     shift 2 ;;
    -e|--environment)   ENVIRONMENT="$2";   shift 2 ;;
    -r|--reasoning|--include-reasoning) INCLUDE_REASONING=true; shift ;;
    --live)             TARGET_LIVE=true;   shift ;;
    --poll-interval)    POLL_INTERVAL="$2"; shift 2 ;;
    --timeout)          POLL_TIMEOUT="$2";  shift 2 ;;
    -h|--help)          usage ;;
    -*) die "Unknown option: $1. Use -h for help." ;;
    *)
      [[ -z "$MESSAGE" ]] || die "Unexpected extra argument: $1"
      MESSAGE="$1"
      shift
      ;;
  esac
done

[[ -n "$AGENT_NAME" ]] || die "Agent name required  (-n <agent-name>)"
[[ -n "$MESSAGE" ]]    || die "A message is required as the last argument"

# ─── Load environment config ──────────────────────────────────────────────────────

if [[ -z "$ENVIRONMENT" ]]; then
  ENVIRONMENT=$(yaml_scalar "$CONFIG_FILE" context active_environment)
  [[ -n "$ENVIRONMENT" ]] || die "No active environment. Run: orchestrate env activate"
fi

WXO_URL=$(yaml_scalar "$CONFIG_FILE" environments "$ENVIRONMENT" wxo_url)
[[ -n "$WXO_URL" ]] || die "No wxo_url for '${ENVIRONMENT}' in ${CONFIG_FILE}"

# ─── Load auth token ─────────────────────────────────────────────────────────────

TOKEN=$(yaml_scalar "$CREDS_FILE" auth "$ENVIRONMENT" wxo_mcsp_token)
[[ -n "$TOKEN" ]] || die "No token for '${ENVIRONMENT}'. Run: orchestrate env activate ${ENVIRONMENT}"

TOKEN_EXPIRY=$(yaml_scalar "$CREDS_FILE" auth "$ENVIRONMENT" wxo_mcsp_token_expiry)
if [[ -n "$TOKEN_EXPIRY" ]]; then
  NOW=$(date +%s)
  if (( NOW >= TOKEN_EXPIRY - 60 )); then
    die "Token for '${ENVIRONMENT}' is expired. Run: orchestrate env activate ${ENVIRONMENT}"
  fi
fi

# ─── Build API endpoints ──────────────────────────────────────────────────────────
# Both local Developer Edition AND IBM Cloud SaaS use the SAME runtime paths:
#   runs    → <wxo_url>/v1/orchestrate/runs   (async; poll /v1/orchestrate/runs/{run_id})
#   agents  → <wxo_url>/v1/orchestrate/agents
#   threads → <wxo_url>/v1/threads
#
# LIVE-VERIFIED 2026-06-29 against IBM Cloud SaaS (us-south, ADK 2.12.0):
#   GET <instance-url>/v1/orchestrate/agents → 200
#   GET <instance-url>/v1/agents            → 404  (WXO-PROXY-14009E)
# An earlier version of this script used /v1/agents + /v1/runs for cloud — that 404s.
# Do not reintroduce a local-vs-cloud split here.

RUNS_ENDPOINT="${WXO_URL}/v1/orchestrate/runs"
AGENTS_ENDPOINT="${WXO_URL}/v1/orchestrate/agents"

# Threads endpoint is /v1/threads (regardless of local vs cloud)
THREADS_ENDPOINT="${WXO_URL}/v1/threads"

# ─── Resolve agent name → agent ID ───────────────────────────────────────────────

AGENTS_FILE="${_TMPDIR}/agents.json"

curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "${AGENTS_ENDPOINT}" \
  -o "$AGENTS_FILE" \
  || die "Failed to list agents at ${AGENTS_ENDPOINT}. Is the server running?"

AGENT_ID=$(python3 - "$AGENT_NAME" "$AGENTS_FILE" <<'PYEOF'
import sys, json

agent_name   = sys.argv[1]
agents_file  = sys.argv[2]

with open(agents_file) as fh:
    raw = json.load(fh)

# Normalise to a flat list — server returns list or {resources/data/items/agents: [...]}
if isinstance(raw, list):
    agents = raw
elif isinstance(raw, dict):
    for key in ("resources", "data", "items", "agents"):
        if key in raw:
            agents = raw[key]
            break
    else:
        agents = list(raw.values())[0] if raw else []
else:
    agents = []

agent_id = None
for a in agents:
    # Entries may be flat or nested under entity/metadata (cloud format)
    candidate = a
    if "entity" in a:
        candidate = {**a.get("metadata", {}), **a.get("entity", {})}
    if candidate.get("name") == agent_name:
        agent_id = candidate.get("agent_id") or candidate.get("id")
        break

print(agent_id or "")
PYEOF
)

[[ -n "$AGENT_ID" ]] || die "Agent '${AGENT_NAME}' not found. Run: orchestrate agents list"

# ─── Resolve the live environment id (only with --live) ─────────────────────────
# The runs API defaults to the agent's draft. To hit the deployed version, pass the
# agent's `live` environment UUID as `environment_id` (live-verified 2.18.0).

ENVIRONMENT_ID=""
if [[ "$TARGET_LIVE" == true ]]; then
  ENVS_FILE="${_TMPDIR}/agent_envs.json"
  curl -sf -H "Authorization: Bearer ${TOKEN}" \
    "${AGENTS_ENDPOINT}/${AGENT_ID}/environment" -o "$ENVS_FILE" \
    || die "Failed to read environments for agent '${AGENT_NAME}'"
  ENVIRONMENT_ID=$(python3 -c "
import sys, json
envs = json.load(open(sys.argv[1]))
live = [e for e in envs if e.get('name') == 'live']
print(live[0]['id'] if live and live[0].get('current_version') else '')
" "$ENVS_FILE")
  [[ -n "$ENVIRONMENT_ID" ]] || die "Agent '${AGENT_NAME}' has no deployed live version. Run: orchestrate agents deploy -n ${AGENT_NAME}"
fi

# ─── Create run ──────────────────────────────────────────────────────────────────

RUN_PAYLOAD_FILE="${_TMPDIR}/run_payload.json"
RUN_RESPONSE_FILE="${_TMPDIR}/run_response.json"

python3 - "$AGENT_ID" "$THREAD_ID" "$MESSAGE" "$RUN_PAYLOAD_FILE" "$ENVIRONMENT_ID" <<'PYEOF'
import sys, json

agent_id       = sys.argv[1]
thread_id      = sys.argv[2]
message        = sys.argv[3]
output_file    = sys.argv[4]
environment_id = sys.argv[5]

payload = {
    "message":      {"role": "user", "content": message},
    "agent_id":     agent_id,
    "capture_logs": False,
}
if thread_id:
    payload["thread_id"] = thread_id
if environment_id:
    payload["environment_id"] = environment_id

with open(output_file, "w") as fh:
    json.dump(payload, fh)
PYEOF

curl -sf \
  -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "@${RUN_PAYLOAD_FILE}" \
  "${RUNS_ENDPOINT}" \
  -o "$RUN_RESPONSE_FILE" \
  || die "Failed to create run at ${RUNS_ENDPOINT}"

RUN_ID=$(python3 -c "
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
print(d.get('run_id', ''))
" "$RUN_RESPONSE_FILE")

THREAD_ID=$(python3 -c "
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
print(d.get('thread_id', ''))
" "$RUN_RESPONSE_FILE")

[[ -n "$RUN_ID" ]]    || die "No run_id in response. See: ${RUN_RESPONSE_FILE}"
[[ -n "$THREAD_ID" ]] || die "No thread_id in response. See: ${RUN_RESPONSE_FILE}"

# ─── Poll for run completion ──────────────────────────────────────────────────────

ELAPSED=0
STATUS_FILE="${_TMPDIR}/run_status.json"
STATUS=""

while true; do
  curl -sf \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "${RUNS_ENDPOINT}/${RUN_ID}" \
    -o "$STATUS_FILE" \
    || die "Failed to poll run at ${RUNS_ENDPOINT}/${RUN_ID}"

  STATUS=$(python3 -c "
import sys, json
with open(sys.argv[1]) as f: d = json.load(f)
print(d.get('status', '').lower())
" "$STATUS_FILE")

  case "$STATUS" in
    completed|failed|cancelled) break ;;
  esac

  ELAPSED=$(( ELAPSED + POLL_INTERVAL ))
  (( ELAPSED < POLL_TIMEOUT )) || die "Timed out after ${POLL_TIMEOUT}s (last status: ${STATUS})"
  sleep "$POLL_INTERVAL"
done

if [[ "$STATUS" == "failed" || "$STATUS" == "cancelled" ]]; then
  python3 - "$STATUS_FILE" "$THREAD_ID" "$STATUS" <<'PYEOF'
import sys, json

status_file = sys.argv[1]
thread_id   = sys.argv[2]
status      = sys.argv[3]

with open(status_file) as fh:
    d = json.load(fh)

error_msg = d.get("error", "Unknown error")
print(json.dumps({
    "status":          "error",
    "thread_id":       thread_id,
    "final_message":   None,
    "reasoning_trace": None,
    "thinking_trace":  [],
    "error":           f"Run {status}: {error_msg}",
}, indent=2))
PYEOF
  exit 1
fi

# ─── Extract the assistant message from the run result ────────────────────────────
# The polled run result already carries the assistant reply at result.data.message
# (with content + step_history). Use it directly. (Earlier versions fetched
# ${THREADS_ENDPOINT}/${THREAD_ID}/messages, which 404s on IBM Cloud SaaS —
# LIVE-VERIFIED 2026-06-29, ADK 2.12.0.) We write it as a single-element list so the
# downstream extractor (which expects a messages array) works unchanged.

MESSAGES_FILE="${_TMPDIR}/messages.json"

python3 - "$STATUS_FILE" "$MESSAGES_FILE" <<'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    run = json.load(f)
msg = run.get("result", {}).get("data", {}).get("message", {})
with open(sys.argv[2], "w") as f:
    json.dump([msg] if msg else [], f)
PYEOF

# ─── Extract and emit structured JSON output ─────────────────────────────────────

python3 - "$MESSAGES_FILE" "$THREAD_ID" "$INCLUDE_REASONING" <<'PYEOF'
import sys, json

messages_file     = sys.argv[1]
thread_id         = sys.argv[2]
include_reasoning = sys.argv[3].lower() == "true"

with open(messages_file) as fh:
    messages_raw = json.load(fh)

# Normalise to a flat list
if isinstance(messages_raw, list):
    messages = messages_raw
elif isinstance(messages_raw, dict):
    messages = messages_raw.get("data", messages_raw.get("messages", []))
else:
    messages = []

# ── Find the most recent assistant message ──────────────────────────────────────
assistant_msg = None
for msg in reversed(messages):
    if isinstance(msg, dict) and msg.get("role") == "assistant":
        assistant_msg = msg
        break

if not assistant_msg:
    print(json.dumps({
        "status":          "error",
        "thread_id":       thread_id,
        "final_message":   None,
        "reasoning_trace": None,
        "thinking_trace":  [],
        "error":           "No assistant message found in thread",
    }, indent=2))
    sys.exit(0)

# ── Extract plain-text content + thinking trace ─────────────────────────────────
# Content may be a plain string or a list of typed response objects:
#   {"response_type": "text",     "text": "..."}   → final answer
#   {"response_type": "thinking", "text": "..."}   → extended-thinking trace
content        = assistant_msg.get("content", "")
thinking_trace = []

if isinstance(content, list):
    text_parts = []
    for item in content:
        if isinstance(item, dict):
            rtype = item.get("response_type", "")
            text  = item.get("text", "")
            if rtype == "text":
                text_parts.append(text)
            elif rtype == "thinking":
                thinking_trace.append(text)
            elif "text" in item:
                text_parts.append(item["text"])
    content = "\n".join(text_parts) if text_parts else str(content)

# ── Extract reasoning trace from step_history ────────────────────────────────────
# The assistant message carries a step_history list when reasoning is available.
# Each step: { step_details: [{type, tool_calls|content|message_id, ...}] }
#
# Types mirror the CLI's format_reasoning_trace():
#   "tool_calls"        → which tools/sub-agents were invoked and with what args
#   "tool_response"     → what the tool returned
#   "message_creation"  → the LLM producing its output
reasoning_trace = None
if include_reasoning:
    steps = assistant_msg.get("step_history", [])
    if steps:
        formatted_steps = []
        for i, step in enumerate(steps, 1):
            step_info   = {"step": i}
            raw_details = step.get("step_details")
            if raw_details:
                detail = raw_details[0] if isinstance(raw_details, list) else raw_details
                stype  = detail.get("type", "unknown")
                step_info["type"] = stype

                if stype == "tool_calls":
                    tool_calls = []
                    for tc in detail.get("tool_calls", []):
                        # Two shapes seen in the wild:
                        #   SaaS runs API: {"name": ..., "args": {...}}
                        #   OpenAI-style:  {"function": {"name": ..., "arguments": "..."}}
                        fn   = tc.get("function", {})
                        name = tc.get("name") or fn.get("name")
                        args = tc.get("args", fn.get("arguments"))
                        try:
                            args = json.loads(args) if isinstance(args, str) else args
                        except (json.JSONDecodeError, TypeError):
                            pass
                        tool_calls.append({
                            "tool":      name,
                            "arguments": args,
                            "agent":     detail.get("agent_display_name"),
                        })
                    step_info["tool_calls"] = tool_calls

                elif stype == "tool_response":
                    step_info["tool_name"]     = detail.get("name")
                    step_info["tool_response"] = detail.get("content")

                elif stype == "message_creation":
                    step_info["message_id"] = detail.get("message_id")

                else:
                    step_info["details"] = detail
            else:
                step_info["raw"] = step

            formatted_steps.append(step_info)
        reasoning_trace = {"steps": formatted_steps}

# ── Emit final result ───────────────────────────────────────────────────────────
print(json.dumps({
    "status":          "success",
    "thread_id":       thread_id,
    "final_message":   content,
    "reasoning_trace": reasoning_trace,
    "thinking_trace":  thinking_trace,
    "error":           None,
}, indent=2))
PYEOF
