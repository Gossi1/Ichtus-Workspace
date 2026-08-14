/**
 * PM2 Ecosystem Configuration
 *
 * Gebruik:
 *   pm2 start ecosystem.config.js
 *   pm2 status
 *   pm2 logs ichtus
 *   pm2 stop ichtus
 *   pm2 restart ichtus
 *
 * PM2 zorgt voor auto-restart bij crashes, log rotation,
 * en geheugenlimieten.
 */

module.exports = {
    apps: [{
        name: 'ichtus',
        script: 'src/server.js',
        node_args: '--experimental-modules',

        // ── Instances ───────────────────────────────────────────────
        instances: 1,           // Single instance (OSC bridge is niet thread-safe)
        exec_mode: 'fork',      // Geen cluster mode

        // ── Environment ────────────────────────────────────────────
        env: {
            NODE_ENV: 'production',
            PORT: 8080,
            HOST: '0.0.0.0',
        },
        env_development: {
            NODE_ENV: 'development',
            PORT: 8080,
            HOST: '127.0.0.1',
        },

        // ── Restart & Stability ────────────────────────────────────
        max_restarts: 10,       // Max herstarts binnen min_restarts_timeout
        min_uptime: '5s',       // Min uptime om als "gestart" te tellen
        restart_delay: 2000,    // 2 seconden tussen herstarts
        max_memory_restart: '300M',  // Restart bij > 300MB

        // ── Logging ────────────────────────────────────────────────
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: 'logs/pm2-error.log',
        out_file: 'logs/pm2-out.log',
        merge_logs: true,
        log_type: 'json',

        // ── Watch (development) ────────────────────────────────────
        watch: false,           // Zet aan in development: watch: ['src/']
        ignore_watch: [
            'node_modules',
            'logs',
            '.git',
            'Ichtus_SPA',
            'x32',
            'mic-iem-server',
            '*.py',
            '*.bat',
        ],

        // ── Graceful shutdown ──────────────────────────────────────
        kill_timeout: 5000,     // 5 seconden voor graceful shutdown
        listen_timeout: 10000,  // 10 seconden voor "ready" signaal
    }],
};
