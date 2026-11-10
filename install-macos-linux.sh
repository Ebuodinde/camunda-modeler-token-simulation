#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$(uname -s)" == "Darwin" ]]; then
  RES_ROOT="$HOME/Library/Application Support/camunda-modeler/resources"
else
  RES_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/camunda-modeler/resources"
fi

TARGET_DIR="$RES_ROOT/plugins/bpmn-token-simulation"
mkdir -p "$TARGET_DIR/client" "$TARGET_DIR/style"

cp "$SCRIPT_DIR/index.js" "$TARGET_DIR/index.js"
cp "$SCRIPT_DIR/package.json" "$TARGET_DIR/package.json"
cp "$SCRIPT_DIR/client/client.js" "$TARGET_DIR/client/client.js"
cp "$SCRIPT_DIR/style/style.css" "$TARGET_DIR/style/style.css"

if [[ ! -f "$RES_ROOT/flags.json" ]]; then
  cp "$SCRIPT_DIR/flags.json" "$RES_ROOT/flags.json"
fi

echo "Installed BPMN Token Simulation & Validation plugin to:"
echo "  $TARGET_DIR"
echo "Restart Camunda Modeler v4.7 to activate."
