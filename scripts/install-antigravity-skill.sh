#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILL_NAME="ariadeck-mcp"
SKILL_SRC="${REPO_ROOT}/.agents/skills/${SKILL_NAME}"
MCP_CLI_DIST="${REPO_ROOT}/packages/mcp-server/dist/cli.js"

CONFIG_DIR="${AGY_CONFIG_DIR:-${HOME}/.gemini/config}"
MODE="symlink"
WITH_MCP=false
UNINSTALL=false

usage() {
  cat <<'EOF'
Usage: install-antigravity-skill.sh [options]

Install or uninstall the Ariadeck MCP skill globally for Antigravity so AI
agents can use Ariadeck from outside this repository.

Options:
  --copy               Copy the skill directory instead of creating a symlink
  --with-mcp           Also register (or remove with --uninstall) the "ariadeck"
                       stdio MCP server in <config-dir>/mcp_config.json
  --config-dir <dir>   Override Antigravity config directory
                       (default: $AGY_CONFIG_DIR or ~/.gemini/config)
  --uninstall          Remove the installed skill (and MCP entry with --with-mcp)
  -h, --help           Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --copy)
      MODE="copy"
      shift
      ;;
    --with-mcp)
      WITH_MCP=true
      shift
      ;;
    --config-dir)
      if [[ $# -lt 2 ]]; then
        echo "Error: --config-dir requires a path argument." >&2
        exit 1
      fi
      CONFIG_DIR="$2"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SKILLS_DIR="${CONFIG_DIR}/skills"
SKILL_DEST="${SKILLS_DIR}/${SKILL_NAME}"
MCP_CONFIG_PATH="${CONFIG_DIR}/mcp_config.json"

update_mcp_config() {
  local action="$1"
  mkdir -p "${CONFIG_DIR}"
  node - "${MCP_CONFIG_PATH}" "${MCP_CLI_DIST}" "${action}" <<'NODE'
const fs = require('node:fs');
const [configPath, cliDistPath, action] = process.argv.slice(2);

let config = {};
if (fs.existsSync(configPath)) {
  const raw = fs.readFileSync(configPath, 'utf8').trim();
  if (raw.length > 0) {
    config = JSON.parse(raw);
  }
  fs.copyFileSync(configPath, `${configPath}.bak`);
}

if (typeof config !== 'object' || config === null || Array.isArray(config)) {
  throw new Error(`Expected JSON object in ${configPath}`);
}
if (!config.mcpServers || typeof config.mcpServers !== 'object') {
  config.mcpServers = {};
}

if (action === 'install') {
  config.mcpServers.ariadeck = {
    command: 'node',
    args: [cliDistPath],
  };
} else if (action === 'uninstall') {
  delete config.mcpServers.ariadeck;
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
NODE
}

if [[ "${UNINSTALL}" == true ]]; then
  if [[ -L "${SKILL_DEST}" || -e "${SKILL_DEST}" ]]; then
    rm -rf "${SKILL_DEST}"
    echo "Removed skill: ${SKILL_DEST}"
  else
    echo "Skill not installed at: ${SKILL_DEST}"
  fi

  if [[ "${WITH_MCP}" == true && -f "${MCP_CONFIG_PATH}" ]]; then
    update_mcp_config "uninstall"
    echo "Removed \"ariadeck\" entry from: ${MCP_CONFIG_PATH}"
  fi
  exit 0
fi

if [[ ! -f "${SKILL_SRC}/SKILL.md" ]]; then
  echo "Error: skill source not found at ${SKILL_SRC}" >&2
  exit 1
fi

mkdir -p "${SKILLS_DIR}"

if [[ -L "${SKILL_DEST}" || -e "${SKILL_DEST}" ]]; then
  rm -rf "${SKILL_DEST}"
fi

if [[ "${MODE}" == "symlink" ]]; then
  ln -s "${SKILL_SRC}" "${SKILL_DEST}"
  echo "Installed skill (symlink): ${SKILL_DEST} -> ${SKILL_SRC}"
else
  cp -R "${SKILL_SRC}" "${SKILL_DEST}"
  echo "Installed skill (copy): ${SKILL_DEST}"
fi

if [[ ! -f "${MCP_CLI_DIST}" ]]; then
  echo "Warning: ${MCP_CLI_DIST} does not exist yet. Run 'pnpm build' before using the MCP server." >&2
fi

if [[ "${WITH_MCP}" == true ]]; then
  update_mcp_config "install"
  echo "Registered \"ariadeck\" MCP server in: ${MCP_CONFIG_PATH}"
else
  cat <<EOF

To also register the Ariadeck MCP server globally for Antigravity, re-run with
--with-mcp, or add the following entry to ${MCP_CONFIG_PATH}:

{
  "mcpServers": {
    "ariadeck": {
      "command": "node",
      "args": ["${MCP_CLI_DIST}"]
    }
  }
}
EOF
fi
