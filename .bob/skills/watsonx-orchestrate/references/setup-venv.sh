#!/bin/bash
# setup_skill_venv.sh
#
# Idempotently:
#   1. Installs uv (if not present) for Windows/Linux/macOS
#   2. Creates a .venv (if not present)
#   3. Installs ibm-watsonx-orchestrate into the .venv
#   4. Activates the .venv in the current shell
#
# Usage (MUST be sourced so activation persists in the calling shell):
#   source ./setup_venv.sh
#
# Designed for use inside an IBM watsonx Orchestrate agentic skill.

# ---------------------------------------------------------------------------
# Guard: warn if executed instead of sourced
# ---------------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    echo "⚠  This script must be sourced, not executed, so the venv activation"
    echo "   persists in your shell.  Run: source ${BASH_SOURCE[0]}"
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

_ok()   { echo -e "${GREEN}✓ $*${NC}"; }
_warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
_err()  { echo -e "${RED}✗ $*${NC}"; }

# ---------------------------------------------------------------------------
# Detect OS
# ---------------------------------------------------------------------------
_detect_os() {
    case "$(uname -s 2>/dev/null)" in
        Darwin*)  echo "mac"   ;;
        Linux*)   echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)
            # Fallback: check for Windows via environment variable
            if [[ -n "${WINDIR:-}" || -n "${windir:-}" ]]; then
                echo "windows"
            else
                echo "unknown"
            fi
            ;;
    esac
}

OS=$(_detect_os)

echo ""
echo "=== watsonx Orchestrate Skill — venv Setup ==="
echo "  Platform detected: ${OS}"
echo ""

# ---------------------------------------------------------------------------
# Step 1 — Install uv (idempotent)
# ---------------------------------------------------------------------------
echo "── Step 1: uv ──────────────────────────────────────────"

_uv_in_path() { command -v uv &>/dev/null; }

if _uv_in_path; then
    _ok "uv already installed: $(uv --version)"
else
    _warn "uv not found — installing..."

    case "${OS}" in
        mac|linux)
            if ! command -v curl &>/dev/null; then
                _err "curl is required to install uv but was not found."
                return 1
            fi
            curl -LsSf https://astral.sh/uv/install.sh | sh

            # The installer places the binary in ~/.local/bin (Linux) or
            # ~/.cargo/bin (older versions).  Add both to PATH.
            for _dir in "$HOME/.local/bin" "$HOME/.cargo/bin"; do
                if [[ -d "${_dir}" && ":${PATH}:" != *":${_dir}:"* ]]; then
                    export PATH="${_dir}:${PATH}"
                fi
            done
            ;;

        windows)
            # On Windows under Git-Bash / MSYS2 we delegate to PowerShell.
            if ! command -v powershell.exe &>/dev/null && \
               ! command -v pwsh.exe &>/dev/null; then
                _err "PowerShell is required to install uv on Windows."
                return 1
            fi
            local _ps
            _ps=$(command -v pwsh.exe 2>/dev/null || command -v powershell.exe)
            "${_ps}" -NoProfile -ExecutionPolicy Bypass -Command \
                "irm https://astral.sh/uv/install.ps1 | iex"

            # Add Windows-style uv path into the Bash PATH.
            local _win_uv="${LOCALAPPDATA}\\Programs\\uv"
            local _unix_uv
            _unix_uv=$(cygpath -u "${_win_uv}" 2>/dev/null || true)
            if [[ -n "${_unix_uv}" && -d "${_unix_uv}" && \
                  ":${PATH}:" != *":${_unix_uv}:"* ]]; then
                export PATH="${_unix_uv}:${PATH}"
            fi
            ;;

        *)
            _err "Unsupported OS '${OS}'. Install uv manually: https://docs.astral.sh/uv/getting-started/installation/"
            return 1
            ;;
    esac

    if _uv_in_path; then
        _ok "uv installed: $(uv --version)"
    else
        _err "uv installation finished but the command is still not in PATH."
        _err "Open a new terminal, then re-source this script."
        return 1
    fi
fi

# ---------------------------------------------------------------------------
# Step 2 — Create .venv (idempotent)
# ---------------------------------------------------------------------------
echo ""
echo "── Step 2: .venv ───────────────────────────────────────"

if [[ -d ".venv" ]]; then
    _ok ".venv already exists — skipping creation"
else
    # Pick the newest available Python in the range 3.11–3.14 (2.18.0 supports 3.14).
    _PYTHON_VER=""
    for _try_ver in "3.14" "3.13" "3.12" "3.11"; do
        if uv python find "${_try_ver}" &>/dev/null; then
            _PYTHON_VER="${_try_ver}"
            break
        fi
    done

    if [[ -z "${_PYTHON_VER}" ]]; then
        _err "No compatible Python (3.11, 3.12, 3.13 or 3.14) found."
        _err "Install one via: uv python install 3.14"
        return 1
    fi

    echo "Creating .venv with Python ${_PYTHON_VER}..."
    if uv venv .venv --python "${_PYTHON_VER}"; then
        _ok ".venv created (Python ${_PYTHON_VER})"
    else
        _err "Failed to create .venv"
        return 1
    fi
fi

# ---------------------------------------------------------------------------
# Step 3 — Install ibm-watsonx-orchestrate (idempotent via uv pip)
# ---------------------------------------------------------------------------
echo ""
echo "── Step 3: ibm-watsonx-orchestrate ────────────────────"

# Resolve the python binary inside the venv (cross-platform)
if [[ "${OS}" == "windows" ]]; then
    _VENV_PYTHON=".venv/Scripts/python.exe"
else
    _VENV_PYTHON=".venv/bin/python"
fi

if [[ ! -f "${_VENV_PYTHON}" ]]; then
    _err "Expected python binary not found at '${_VENV_PYTHON}'."
    return 1
fi

echo "Installing / verifying ibm-watsonx-orchestrate..."
# Pinned to 2.18.0 — the version this skill's guidance was live-verified against
# (IBM Cloud SaaS, 2026-10-01). Bump deliberately; do not let it silently fall behind.
if uv pip install --python "${_VENV_PYTHON}" ibm-watsonx-orchestrate==2.18.0; then
    _ok "ibm-watsonx-orchestrate ready"
else
    _err "Failed to install ibm-watsonx-orchestrate"
    return 1
fi

# ---------------------------------------------------------------------------
# Step 4 — Activate .venv in the current shell
# ---------------------------------------------------------------------------
echo ""
echo "── Step 4: activate .venv ──────────────────────────────"

if [[ "${OS}" == "windows" ]]; then
    _ACTIVATE=".venv/Scripts/activate"
else
    _ACTIVATE=".venv/bin/activate"
fi

if [[ ! -f "${_ACTIVATE}" ]]; then
    _err "Activation script not found at '${_ACTIVATE}'."
    return 1
fi

# shellcheck disable=SC1090
source "${_ACTIVATE}"
_ok ".venv activated  (python: $(command -v python))"

# ---------------------------------------------------------------------------
echo ""
echo "=== Setup complete — virtual environment is active ==="
echo ""