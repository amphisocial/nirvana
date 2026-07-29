// PM2 config for the Next.js build of NIRVANA.
// IMPORTANT: run `npm run build` before starting/restarting — `next start`
// serves the prebuilt .next output, so a restart without a rebuild serves
// stale code.
module.exports = {
  apps: [
    {
      name: "nirvana",
      cwd: "/opt/apps/nirvana",
      // Run Next's production server directly (more reliable signal handling
      // under PM2 than going through npm).
      script: "node_modules/next/dist/bin/next",
      args: "start -p 5015",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "750M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 5015,
      },
      error_file: "/var/log/pm2/nirvana-error.log",
      out_file: "/var/log/pm2/nirvana-out.log",
      merge_logs: true,
    },
  ],
};
