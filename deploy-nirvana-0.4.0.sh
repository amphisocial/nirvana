#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/apps/nirvana"
PATCH_FILE="/tmp/nirvana-0.4.0.patch"
EXPECTED_BASE="91fa94f60a8d7398dbef3d1ae42d60b1df85f2ea"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="/tmp/nirvana-source-before-0.4.0-${STAMP}.tgz"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR is not a Git checkout"
[[ -f "$PATCH_FILE" ]] || fail "Upload nirvana-0.4.0.patch to $PATCH_FILE"

cd "$APP_DIR"

[[ -z "$(git status --porcelain)" ]] || {
  git status --short
  fail "The Nirvana working tree is not clean. Commit or stash those changes before deployment."
}

echo "Fetching the exact production baseline..."
git fetch origin main
git pull --ff-only origin main
ACTUAL_BASE="$(git rev-parse HEAD)"
[[ "$ACTUAL_BASE" == "$EXPECTED_BASE" ]] || fail "Expected base $EXPECTED_BASE but found $ACTUAL_BASE. Do not force the patch."

echo "Checking patch compatibility..."
git apply --check "$PATCH_FILE"

echo "Creating source backup at $BACKUP_FILE ..."
tar --exclude='.git' --exclude='.env' --exclude='node_modules' \
  -czf "$BACKUP_FILE" \
  README.md package.json package-lock.json db docs public scripts server tests

echo "Applying Nirvana 0.4.0..."
git apply "$PATCH_FILE"

echo "Running JavaScript syntax checks..."
while IFS= read -r file; do
  node --check "$file"
done < <(find server public scripts tests -type f -name '*.js' | sort)

echo "Running automated tests..."
npm test

echo "Applying database migrations..."
npm run db:migrate

echo "Restarting only the Nirvana PM2 process..."
pm2 restart nirvana --update-env
pm2 save

sleep 2
echo "Checking service health..."
curl -fsS http://127.0.0.1:5015/api/health
echo

echo "Nirvana 0.4.0 deployed successfully."
echo "Backup: $BACKUP_FILE"
echo "Hard-refresh Chrome with Command + Shift + R."
echo
echo "After validating the UI:"
echo "  cd /opt/apps/nirvana"
echo "  git add README.md DEPLOY_NIRVANA_0.4.0.md db docs public server tests package.json package-lock.json"
echo "  git commit -m 'Add blue planning dashboard and holdings forecasts'"
echo "  git push origin main"
