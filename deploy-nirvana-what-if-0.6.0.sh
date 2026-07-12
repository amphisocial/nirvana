#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/apps/nirvana"
ZIP_FILE="/tmp/nirvana-what-if-0.6.0-files.zip"
EXPECTED_BASE="0babff3b82e31833aa632b20b3029c7ebdf2fee5"
STAGE_DIR="/tmp/nirvana-what-if-0.6.0-stage"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/tmp/nirvana-before-what-if-0.6.0-${STAMP}.tgz"
DEPLOYED=0

NEW_PATHS=(
  public/what-if-ui.js
  public/what-if.css
  server/routes/what-if.js
  server/services/what-if-engine.js
  server/services/what-if-parser.js
  tests/what-if-engine.test.js
  docs/WHAT_IF_LAB_0.6.0.md
  docs/what-if-section.html
)

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

rollback() {
  local code=$?
  if [[ $DEPLOYED -eq 1 ]]; then
    exit "$code"
  fi
  echo
  echo "Deployment failed. Restoring the source backup..." >&2
  cd "$APP_DIR" 2>/dev/null || exit "$code"
  rm -f "${NEW_PATHS[@]}"
  [[ -f "$BACKUP" ]] && tar -xzf "$BACKUP" -C "$APP_DIR"
  exit "$code"
}
trap rollback ERR

[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR is not a Git checkout"
[[ -f "$ZIP_FILE" ]] || fail "Upload nirvana-what-if-0.6.0-files.zip to $ZIP_FILE"

cd "$APP_DIR"

# Ignore untracked deployment artifacts, but never overwrite tracked work.
git diff --quiet || fail "Tracked files have uncommitted changes. Commit or restore them first."
git diff --cached --quiet || fail "The Git index has staged changes. Commit or unstage them first."

echo "Fetching the exact GitHub baseline..."
git fetch origin main
git pull --ff-only origin main
ACTUAL_BASE="$(git rev-parse HEAD)"
[[ "$ACTUAL_BASE" == "$EXPECTED_BASE" ]] \
  || fail "Expected GitHub main $EXPECTED_BASE but found $ACTUAL_BASE. Do not force this package."

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$ZIP_FILE" -d "$STAGE_DIR"

for path in "${NEW_PATHS[@]}"; do
  [[ -f "$STAGE_DIR/$path" ]] || fail "Package is missing $path"
done

echo "Creating backup at $BACKUP ..."
tar --ignore-failed-read -czf "$BACKUP" \
  public/app.html \
  server/index.js \
  "${NEW_PATHS[@]}"

echo "Installing modular What-If files..."
for path in "${NEW_PATHS[@]}"; do
  mkdir -p "$(dirname "$APP_DIR/$path")"
  install -m 0644 "$STAGE_DIR/$path" "$APP_DIR/$path"
done

python3 <<'PY'
from pathlib import Path
import re

root = Path('/opt/apps/nirvana')
app_path = root / 'public/app.html'
index_path = root / 'server/index.js'
template_path = root / 'docs/what-if-section.html'

app = app_path.read_text()
template = template_path.read_text().strip()

pattern = re.compile(r'<section id="scenario" class="view">[\s\S]*?</section>')
app, count = pattern.subn(template, app, count=1)
if count != 1:
    raise SystemExit('Could not replace the existing scenario section exactly once.')

if '/what-if.css?v=0.6.0' not in app:
    match = re.search(r'(<link rel="stylesheet" href="/styles\.css\?v=[^"]+">)', app)
    if not match:
        raise SystemExit('Could not find the main stylesheet link in public/app.html.')
    app = app[:match.end()] + '\n  <link rel="stylesheet" href="/what-if.css?v=0.6.0">' + app[match.end():]

if '/what-if-ui.js?v=0.6.0' not in app:
    marker = '</body>'
    if marker not in app:
        raise SystemExit('Could not find </body> in public/app.html.')
    app = app.replace(marker, '  <script src="/what-if-ui.js?v=0.6.0" defer></script>\n' + marker, 1)

app_path.write_text(app)

index = index_path.read_text()
import_line = "import { whatIfRouter } from './routes/what-if.js';"
if import_line not in index:
    import_anchor = "import { scenariosRouter } from './routes/scenarios.js';"
    if import_anchor not in index:
        raise SystemExit('Could not find the scenariosRouter import in server/index.js.')
    index = index.replace(import_anchor, import_anchor + '\n' + import_line, 1)

use_line = "app.use('/api/what-if', whatIfRouter);"
if use_line not in index:
    use_anchor = "app.use('/api/scenarios', scenariosRouter);"
    if use_anchor not in index:
        raise SystemExit('Could not find the scenarios API registration in server/index.js.')
    index = index.replace(use_anchor, use_anchor + '\n' + use_line, 1)

index_path.write_text(index)
PY

echo "Validating JavaScript syntax..."
node --check public/what-if-ui.js
node --check server/routes/what-if.js
node --check server/services/what-if-engine.js
node --check server/services/what-if-parser.js
node --check server/index.js

echo "Running the full automated test suite..."
npm test

echo "Verifying that this release has no database migration..."
! find db -maxdepth 1 -type f -name '*006*' | grep -q . \
  || fail "Unexpected migration 006 detected. This release must remain non-persistent."

echo "Restarting only Nirvana..."
pm2 restart nirvana --update-env
pm2 save

sleep 2
echo "Checking service health..."
curl -fsS http://127.0.0.1:5015/api/health
echo

DEPLOYED=1
trap - ERR

echo
echo "Nirvana What-If Lab 0.6.0 deployed successfully."
echo "Base commit: $EXPECTED_BASE"
echo "Backup: $BACKUP"
echo "No database migration or npm install was performed."
echo "Hard-refresh Chrome with Command + Shift + R."
