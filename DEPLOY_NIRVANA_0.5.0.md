# Deploy Nirvana 0.5.0

The package is a flat repository-relative update. It does not contain `.env`, `.git`, `node_modules`, Nginx configuration, or PM2 configuration.

Upload:

```text
/tmp/nirvana-0.5.0-files.zip
/tmp/deploy-nirvana-0.5.0.sh
```

Run:

```bash
chmod +x /tmp/deploy-nirvana-0.5.0.sh
/tmp/deploy-nirvana-0.5.0.sh
```

The script backs up affected files, overlays the flat package, validates JavaScript, runs tests, applies migration 005, restarts only Nirvana, and checks the local health endpoint.
