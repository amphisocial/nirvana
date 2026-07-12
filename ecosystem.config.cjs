module.exports = {
  apps: [
    {
      name: 'nirvana',
      cwd: '/opt/apps/nirvana',
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '750M',
      time: true,
      env: {
        NODE_ENV: 'development',
        PORT: 5015
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5015
      },
      error_file: '/var/log/pm2/nirvana-error.log',
      out_file: '/var/log/pm2/nirvana-out.log',
      merge_logs: true
    }
  ]
};
