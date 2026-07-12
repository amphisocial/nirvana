# Nirvana asset/liability edit and delete overlay

Adds:

- Edit and delete controls to every saved asset and liability
- Reuse of the existing add forms for editing
- Cancel-edit controls
- Confirmation before deletion
- Warning that deleting an asset also deletes its imported holdings
- Household-scoped `PUT` and `DELETE` routes
- Browser form-reset fix
- Liability institution returned by the dashboard API

## Install

```bash
cd /tmp
unzip nirvana-account-edit-delete-v1-overlay.zip

sudo cp -a   /opt/apps/nirvana   /opt/apps/nirvana-backup-before-account-edit-delete

sudo rsync -av   --exclude INSTALL.md   nirvana-account-edit-delete-v1-overlay/   /opt/apps/nirvana/

sudo chown -R ubuntu:ubuntu /opt/apps/nirvana
cd /opt/apps/nirvana

node --check server/routes/accounts.js
node --check server/routes/dashboard.js
node --check public/app.js

pm2 restart nirvana
pm2 save
```

No database migration and no npm installation are required.

After restarting, hard-refresh the browser with `Command + Shift + R` on Mac or `Ctrl + Shift + R` on Windows/Linux.
