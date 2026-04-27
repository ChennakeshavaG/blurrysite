#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')"
[ -z "$FILE_PATH" ] && exit 0

# Project root = two levels up from .claude/hooks/
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Derive relative path; bail if file is outside this project
REL_PATH="${FILE_PATH#"$PROJECT_ROOT/"}"
[ "$REL_PATH" = "$FILE_PATH" ] && exit 0

# Match covered files and derive contract key.
# Patterns mirror the docs/contracts/ tree: src/foo.js → docs/contracts/foo.md;
# nested src/core/foo.js → docs/contracts/core/foo.md.
CONTRACT_KEY=""
if [[ "$REL_PATH" =~ ^src/(.+)\.js$ ]]; then
  CONTRACT_KEY="${BASH_REMATCH[1]}"
elif [[ "$REL_PATH" =~ ^popup/renders/([a-z_]+)\.js$ ]]; then
  CONTRACT_KEY="popup_renders_${BASH_REMATCH[1]}"
elif [[ "$REL_PATH" =~ ^popup/([a-z_]+)\.js$ ]]; then
  CONTRACT_KEY="popup_${BASH_REMATCH[1]}"
elif [[ "$REL_PATH" =~ ^tests/unit/(.+)\.test\.js$ ]]; then
  CONTRACT_KEY="${BASH_REMATCH[1]}.tests"
elif [ "$REL_PATH" = "background.js" ]; then
  CONTRACT_KEY="background"
elif [ "$REL_PATH" = "content_script.js" ]; then
  CONTRACT_KEY="content_script"
else
  exit 0
fi

CONTRACT_FILE="$PROJECT_ROOT/docs/contracts/$CONTRACT_KEY.md"

if [ -f "$CONTRACT_FILE" ]; then
  MSG="Contract check — $REL_PATH
→ Read docs/contracts/$CONTRACT_KEY.md before making changes.
→ Documents every public function: purpose, params, returns, side effects, edge cases.
→ After adding/modifying/removing any function, update the contract in the same commit."
else
  MSG="Missing contract — $REL_PATH
→ docs/contracts/$CONTRACT_KEY.md does not exist.
→ CLAUDE.md Rule 5 (mandatory): every module must have a contract before it is edited.
→ Create docs/contracts/$CONTRACT_KEY.md documenting the public API before proceeding.
→ Contract must cover: purpose, all public functions, params, returns, side effects, edge cases."
fi

jq -n --arg msg "$MSG" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    additionalContext: $msg
  }
}'
