#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/apps/nirvana/"
ZIP_FILE="/opt/apps/nirvana/nirvana-0.5.0-files.zip"
STAGE_DIR="/tmp/nirvana-0.5.0-stage"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="/tmp/nirvana-source-before-0.5.0-${STAMP}.tgz"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -d "$APP_DIR" ]] || fail "$APP_DIR does not exist"
[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR is not a Git checkout"
[[ -f "$ZIP_FILE" ]] || fail "Upload nirvana-0.5.0-files.zip to $ZIP_FILE"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
unzip -q "$ZIP_FILE" -d "$STAGE_DIR"

[[ -f "$STAGE_DIR/db/005_scheduled_contributions_and_future_expenses.sql" ]] \
  || fail "The ZIP did not extract as a flat repository-relative package"
[[ -f "$STAGE_DIR/public/planning-ui.js" ]] \
  || fail "public/planning-ui.js is missing from the package"
[[ -f "$STAGE_DIR/server/services/account-contribution.js" ]] \
  || fail "server/services/account-contribution.js is missing from the package"

cd "$APP_DIR"

echo "Creating source backup at $BACKUP_FILE ..."
tar \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='node_modules' \
  -czf "$BACKUP_FILE" \
  package.json package-lock.json db docs public server tests

echo "Previewing files in the 0.5.0 package..."
find "$STAGE_DIR" -type f | sed "s#^$STAGE_DIR/##" | sort

echo "Installing the flat source update..."
rsync -av "$STAGE_DIR/" "$APP_DIR/"
cd "$APP_DIR"

echo "Running JavaScript syntax checks..."
for file in \
  public/app.js \
  public/planning-ui.js \
  public/portfolio-ui.js \
  server/routes/accounts.js \
  server/routes/chat.js \
  server/routes/planning.js \
  server/services/account-contribution.js \
  server/services/net-worth-projection.js \
  server/services/net-worth-service.js \
  server/services/retirement-cashflow-engine.js \
  server/services/retirement-service.js
  do
    node --check "$file"
  done

echo "Running automated tests..."
npm test

echo "Applying database migrations..."
npm run db:migrate

echo "Restarting only Nirvana..."
pm2 restart nirvana --update-env
pm2 save

sleep 2
echo "Checking service health..."
curl -fsS http://127.0.0.1:5015/api/health
echo

echo "Nirvana 0.5.0 deployed successfully."
echo "Backup: $BACKUP_FILE"
echo "Hard-refresh Chrome with Command + Shift + R."
