# Build validation

Completed for this Phase 1 scaffold:

- Dependency resolution completed with `npm install --package-lock-only`.
- Full dependency install completed with `npm ci`.
- Every JavaScript file passed `node --check`.
- Five unit tests passed:
  - buy scenario portfolio conservation at execution
  - oversell rejection
  - seeded retirement simulation repeatability
  - company-name/ticker and time-range routing
  - Markdown skill-agent selection
- Landing page and authentication-status routes returned HTTP 200 in a startup smoke test.
- A secret-pattern scan found no embedded API keys or private keys.

A full end-to-end dashboard test requires a running PostgreSQL instance and the environment values described in `.env.example`.
