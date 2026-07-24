#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_FILE="$SCRIPT_DIR/nirvana-agent-scheduler-controls.patch"

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: $ROOT" >&2
  exit 1
fi

if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
  echo "Your working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

git -C "$ROOT" apply --check "$PATCH_FILE"
git -C "$ROOT" apply "$PATCH_FILE"

cat <<'EOF'
Applied Nirvana scheduled-agent controls.

Next:
  npm install
  npm run db:migrate
  npm test
  git add .
  git commit -m "Add scheduled agent pause controls"
  git push

On EC2 after git pull:
  npm install --omit=dev
  npm run db:migrate
  pm2 restart nirvana --update-env
EOF
