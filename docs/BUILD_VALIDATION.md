# Build validation

Completed for this Phase 1 scaffold:

- `package-lock.json` is valid lockfile v3 and all package tarball URLs point to `registry.npmjs.org`.
- The repository includes `.npmrc` to force the public npm registry on the deployment host.
- The application dependency set and tests were validated before packaging; the final public-registry lockfile should be installed on the internet-connected server with the command in the deployment guide.
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
