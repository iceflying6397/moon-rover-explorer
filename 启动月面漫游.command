#!/bin/zsh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  node scripts/serve.mjs --open
elif [ -x "$HOME/.hermes/node/bin/node" ]; then
  "$HOME/.hermes/node/bin/node" scripts/serve.mjs --open
else
  echo "请安装 Node.js 22 或更新版本后，再双击启动。"
  read -k 1
fi
