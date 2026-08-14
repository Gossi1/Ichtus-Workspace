/**
 * System Routes
 *
 * Verenigt de server.py endpoints (NDI, Tockify, library, git pull,
 * health/status) met de supervisor.py endpoints (update checking,
 * restart) in één Express Router.
 *
 * Vervangt zowel server.py als supervisor.py.
 */

import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { hostname } from 'os';
import { discoverNdISources } from '../lib/ndi.js';

const execFileAsync = promisify(execFile);
const PORT = parseInt(process.env.PORT, 10) || 8080;
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');

// ── Configuratie ───────────────────────────────────────────────────────
const UPDATE_CONFIG = {
    github_repo: 'Gossi1/Ichtus-Workspace',
    current_version: '3.0.0',
};

// ── Server state ───────────────────────────────────────────────────────
const startTime = Date.now();
let requestCount = 0;
const logBuffer = [];
const LOG_BUFFER_MAX = 50;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    logBuffer.push(line);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
    console.log(`  ${msg}`);
}

// ── Firebase config injection ──────────────────────────────────────────
let firebaseConfig = null;

function loadFirebaseConfig() {
    const configFile = resolve(ROOT_DIR, 'firebase-api-key.txt');
    if (!existsSync(configFile)) return null;

    try {
        const content = readFileSync(configFile, 'utf-8');
        const config = {};
        const keys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
        for (const key of keys) {
            const match = content.match(new RegExp(`${key}:\\s*["']([^"']+)["']`));
            if (match) config[key] = match[1];
        }
        if (config.apiKey && !config.apiKey.startsWith('YOUR_')) return config;
    } catch (e) {
        console.warn(`  [WARN] Could not load firebase config: ${e.message}`);
    }
    return null;
}

function getFirebaseConfig() {
    if (firebaseConfig === null) firebaseConfig = loadFirebaseConfig();
    return firebaseConfig;
}

// ── Library helpers ────────────────────────────────────────────────────

function getLibraryConfigPath() {
    return resolve(ROOT_DIR, 'library-config.json');
}

function loadLibraryConfig() {
    const cfgPath = getLibraryConfigPath();
    if (existsSync(cfgPath)) {
        try { return JSON.parse(readFileSync(cfgPath, 'utf-8')); } catch (_) {}
    }
    return {};
}

function getLibraryPathSync() {
    const cfg = loadLibraryConfig();
    const configured = cfg.libraryPath || '';
    if (configured && existsSync(resolve(configured, '..'))) {
        return configured;
    }
    return resolve(ROOT_DIR, 'song-id-assigner', 'library-ids.json');
}

// ── Express Router ─────────────────────────────────────────────────────

const router = Router();

// Middleware: tel requests
router.use((req, res, next) => {
    requestCount++;
    next();
});

// ── Health & Status ────────────────────────────────────────────────────

router.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    res.json({
        status: 'ok',
        service: 'ichtus-spa',
        pid: process.pid,
        uptime_sec: uptime,
        requests_served: requestCount,
        timestamp: new Date().toISOString(),
    });
});

router.get('/status', async (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Git update status (for supervisor badges)
    let update = { update_available: false, behind_count: 0, branch: 'master' };
    try {
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, timeout: 5_000 });
        const branch = branchOut.trim();
        const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', `HEAD..origin/${branch}`], { cwd: ROOT_DIR, timeout: 10_000 });
        const count = parseInt(countOut.trim(), 10) || 0;
        update = { update_available: count > 0, behind_count: count, branch };
    } catch (_) {}

    // Services array — everything runs in one process now
    const services = [
        {
            key: 'server',
            label: 'Ichtus Server (Node.js)',
            state: 'running',
            pid: process.pid,
            uptime_sec: uptime,
            restart_count: 0,
            last_exit_code: null,
            default_port: PORT,
            log_path: 'logs/service-output.log',
        },
    ];

    res.json({
        service: 'ichtus-spa',
        status: 'ok',
        pid: process.pid,
        uptime_sec: uptime,
        started_at: new Date(startTime).toISOString(),
        requests_served: requestCount,
        hostname: hostname(),
        version: UPDATE_CONFIG.current_version,
        services,
        update,
        log_tail: [...logBuffer],
        log_tail_size: logBuffer.length,
        log_buffer_capacity: LOG_BUFFER_MAX,
        timestamp: new Date().toISOString(),
    });
});

// ── NDI Discovery ──────────────────────────────────────────────────────

router.get('/ndi/sources', async (req, res) => {
    try {
        const result = await discoverNdISources();
        res.json(result);
    } catch (err) {
        console.error('  ⚠️  NDI API error:', err.message);
        res.json({ error: err.message, sources: [], count: 0 });
    }
});

// ── Tockify ICS Proxy ──────────────────────────────────────────────────

router.get('/tockify/ics', async (req, res) => {
    try {
        const response = await fetch('https://tockify.com/api/feeds/ics/ichtus', {
            headers: { 'User-Agent': 'Ichtus-Workspace' },
            signal: AbortSignal.timeout(15_000),
        });
        const icsData = await response.text();
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'no-cache');
        res.send(icsData);
    } catch (err) {
        res.status(502).json({ error: `Tockify unreachable: ${err.message}` });
    }
});

// ── Git Pull ───────────────────────────────────────────────────────────

router.post('/update', async (req, res) => {
    try {
        const { stdout: fetchOut } = await execFileAsync('git', ['fetch', 'origin'], { cwd: ROOT_DIR, timeout: 30_000 });
        const { stdout: pullOut, stderr: pullErr, status } = await execFileAsync('git', ['pull'], { cwd: ROOT_DIR, timeout: 30_000 });

        const lines = [];
        if (fetchOut.trim()) lines.push('$ git fetch origin', ...fetchOut.trim().split('\n').map((l) => '  ' + l));
        lines.push('', '$ git pull', ...pullOut.trim().split('\n').map((l) => '  ' + l));
        if (pullErr.trim()) lines.push(...pullErr.trim().split('\n').map((l) => '  ⚠ ' + l));

        const success = status === 0;
        log(`git pull ${success ? 'geslaagd' : 'mislukt'}`);
        res.json({ success, exit_code: status, output: lines.join('\n'), message: success ? 'git pull voltooid.' : 'git pull had fouten.' });
    } catch (err) {
        if (err.killed) {
            res.status(504).json({ success: false, output: 'Timeout: git pull duurde langer dan 30 seconden.', message: 'Git pull timeout.' });
        } else if (err.code === 'ENOENT') {
            res.json({ success: false, output: 'Git is niet geïnstalleerd.', message: 'Git niet gevonden.' });
        } else {
            res.status(500).json({ success: false, output: err.message, message: 'Onverwachte fout.' });
        }
    }
});

// ── Update Checking ────────────────────────────────────────────────────

router.get('/check-update', async (req, res) => {
    try {
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, timeout: 10_000 });
        const branch = branchOut.trim();

        await execFileAsync('git', ['fetch', 'origin'], { cwd: ROOT_DIR, timeout: 30_000 });

        const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', `HEAD..origin/${branch}`], { cwd: ROOT_DIR, timeout: 10_000 });
        const count = parseInt(countOut.trim(), 10) || 0;

        res.json({
            update_available: count > 0,
            behind_count: count,
            branch,
            checked_at: new Date().toISOString(),
        });
    } catch (err) {
        res.json({ update_available: false, behind_count: 0, error: err.message?.slice(0, 200) });
    }
});

// ── Service Restart (minimalistic — signals PM2 or self) ───────────────

router.post('/restart/:key', async (req, res) => {
    const { key } = req.params;
    log(`restart requested for: ${key}`);
    // In PM2 context, pm2.restart() is called externally
    // For now we just acknowledge — PM2 handles the actual restart
    res.json({ success: true, message: `Restart ${key} aangevraagd. PM2 handelt het af.` });
});

router.post('/restart-all', async (req, res) => {
    log('restart-all requested');
    res.json({ success: true, message: 'Alle services worden herstart door PM2.' });
});

// ── Logs ───────────────────────────────────────────────────────────────

router.get('/logs/:key', (req, res) => {
    const { key } = req.params;
    // Return the last log entries from our buffer
    const tail = logBuffer.slice(-30).map((line) => ({
        ts: new Date().toISOString(),
        line,
    }));
    res.json({ tail, key });
});

// ── Song ID Assigner Library ───────────────────────────────────────────

router.get('/library/files', (req, res) => {
    try {
        const libDir = resolve(ROOT_DIR, 'song-id-assigner');
        const files = [];
        if (existsSync(libDir)) {
            const entries = readdirSync(libDir).sort();
            for (const name of entries) {
                if (!name.toLowerCase().endsWith('.json')) continue;
                const stat = statSync(resolve(libDir, name));
                files.push({
                    name,
                    size: stat.size,
                    modified: new Date(stat.mtimeMs).toISOString(),
                });
            }
        }
        res.json({ success: true, files });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/library/config', (req, res) => {
    try {
        const cfg = loadLibraryConfig();
        const libPath = getLibraryPathSync();
        res.json({
            success: true,
            libraryPath: cfg.libraryPath || '',
            resolvedPath: libPath,
            fileExists: existsSync(libPath),
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/library/config', (req, res) => {
    try {
        const rawPath = (req.body?.libraryPath || '').trim();
        if (!rawPath) throw new Error('libraryPath mag niet leeg zijn');

        const libPath = resolve(rawPath);
        mkdirSync(resolve(libPath, '..'), { recursive: true });

        if (!existsSync(libPath)) {
            writeFileSync(libPath, JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), songs: [] }, null, 2), 'utf-8');
        }

        const cfg = { libraryPath: libPath, updatedAt: new Date().toISOString() };
        writeFileSync(getLibraryConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');

        res.json({ success: true, libraryPath: libPath, message: `Bibliotheek gekoppeld aan ${basename(libPath)}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/library/load', (req, res) => {
    try {
        let libPath;
        if (req.query.file) {
            let fileOverride = decodeURIComponent(req.query.file);
            fileOverride = basename(fileOverride);
            if (!fileOverride.endsWith('.json')) fileOverride += '.json';
            libPath = resolve(ROOT_DIR, 'song-id-assigner', fileOverride);
        } else {
            libPath = getLibraryPathSync();
        }

        const data = existsSync(libPath)
            ? JSON.parse(readFileSync(libPath, 'utf-8'))
            : { schemaVersion: 1, songs: [] };

        res.json({ success: true, library: data, file: basename(libPath), path: libPath });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/library/save', (req, res) => {
    try {
        const data = req.body;
        const bodyStr = JSON.stringify(data);
        if (bodyStr.length > 10 * 1024 * 1024) throw new Error('Payload te groot');

        const songs = data.songs;
        if (!Array.isArray(songs)) throw new Error('songs moet een lijst zijn');

        const clean = [];
        for (const s of songs) {
            if (typeof s !== 'object' || !s) continue;
            const title = String(s.title || '').trim();
            if (!title) continue;

            const prefix = String(s.prefix || '').trim();
            const number = String(s.number || '').trim();

            if (prefix && !/^[A-Za-z]{1,4}$/.test(prefix)) continue;
            if (number && !/^\d{1,4}[A-Za-z]?$/.test(number)) continue;
            if (Boolean(prefix) !== Boolean(number)) continue;

            const altTitles = [];
            const seenLower = new Set();
            if (Array.isArray(s.altTitles)) {
                for (const t of s.altTitles.slice(0, 50)) {
                    const str = String(t || '').trim();
                    const key = str.toLowerCase();
                    if (str && !seenLower.has(key)) {
                        seenLower.add(key);
                        altTitles.push(str);
                    }
                }
            }

            clean.push({
                uid: String(s.uid || ''),
                id: (prefix && number) ? prefix + number : '',
                prefix, number, title,
                artist: String(s.artist || ''),
                altTitles,
            });
        }

        let libPath = getLibraryPathSync();
        let fileParam = String(data.file || '');
        if (fileParam) {
            fileParam = basename(fileParam);
            if (!fileParam.endsWith('.json')) fileParam += '.json';
            const cfg = loadLibraryConfig();
            if (!cfg.libraryPath) {
                mkdirSync(resolve(ROOT_DIR, 'song-id-assigner'), { recursive: true });
                libPath = resolve(ROOT_DIR, 'song-id-assigner', fileParam);
            }
        }

        mkdirSync(resolve(libPath, '..'), { recursive: true });

        let existingCount = 0;
        if (existsSync(libPath)) {
            try {
                const existing = JSON.parse(readFileSync(libPath, 'utf-8'));
                existingCount = (existing.songs || []).length;
            } catch (_) {}
        }
        if (existingCount > 50 && clean.length < 5) {
            throw new Error(`Weigering: bestand heeft ${existingCount} liederen, maar payload maar ${clean.length}. Bewuste leegmaak? Verwijder eerst ${fileParam}.`);
        }

        const backupPath = libPath + '.bak';
        if (existsSync(libPath)) {
            try { copyFileSync(libPath, backupPath); } catch (_) {}
        }

        const out = {
            schemaVersion: parseInt(data.schemaVersion) || 1,
            updatedAt: data.updatedAt || new Date().toISOString(),
            songs: clean,
        };
        writeFileSync(libPath, JSON.stringify(out, null, 2), 'utf-8');

        log(`Library opgeslagen: ${clean.length} songs → ${basename(libPath)}`);
        res.json({ success: true, count: clean.length, file: fileParam, path: libPath, backup: backupPath });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Test endpoint (backward compat) ────────────────────────────────────

router.get('/test', (req, res) => {
    res.json({ test: 'ok', server: 'IchtusNodeServer' });
});

export { getFirebaseConfig };
export default router;
