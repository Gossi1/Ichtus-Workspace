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
import path, { resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { hostname } from 'os';
import { discoverNdISources } from '../lib/ndi.js';
import { broadcast as wsBroadcast } from '../ws.js';

const execFileAsync = promisify(execFile);

// execFileAsync throws on non-zero git exit codes, but pre-/post-checks in
// /api/update need to know the actual exit code rather than treat any
// failure as a thrown exception. `runGit` resolves with the full result
// regardless of exit status so callers can compute their own success flag
// from real git behaviour.
function runGit(args, options = {}) {
    return new Promise((resolve) => {
        execFile('git', args, { cwd: ROOT_DIR, ...options }, (err, stdout, stderr) => {
            resolve({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: err ? (err.code ?? 1) : 0,
                error: err || null,
            });
        });
    });
}

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

// ── Firebase Config (browser kan dit ophalen via fetch) ──────────────

router.get('/firebase-config', (req, res) => {
    const config = getFirebaseConfig();
    if (!config) {
        return res.status(404).json({ error: 'Firebase config niet gevonden. Maak firebase-api-key.txt aan in de project root.' });
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.json(config);
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
        // Failure status starts at 1 (failure) and is overwritten by the
        // exit code of each git invocation; the variable previously lived
        // here as `let status = 0` but was never mutated, so `success`
        // degenerated to `!pullError` and the popup flagged fast-forwards
        // as "git pull had fouten." when `pullError` was set elsewhere.
        let status = 1;
        let pullError = null;

        // Pre-flight: bail out early if there are local uncommitted
        // changes that would make `git pull` refuse to merge. The popup
        // surfaces the reason instead of getting a cryptic git error.
        try {
            const { stdout: statusOut } = await execFileAsync(
                'git', ['status', '--porcelain'],
                { cwd: ROOT_DIR, timeout: 10_000 }
            );
            if (statusOut && statusOut.trim()) {
                const dirty = statusOut.trim().split('\n').slice(0, 8).join('\n');
                pullError = `Lokale wijzigingen blokkeren de pull:\n${dirty}${statusOut.trim().split('\n').length > 8 ? '\n  …' : ''}`;
            }
        } catch { /* non-fatal — fall through to actual pull attempt */ }

        const fetchRes = await runGit(['fetch', 'origin'], { timeout: 30_000 });
        const pullRes  = await runGit(['pull'],            { timeout: 30_000 });

        // status reflects the actual git outcomes: 0 only when both
        // fetch and pull exited cleanly.
        if (fetchRes.exitCode === 0 && pullRes.exitCode === 0) status = 0;

        const { stdout: pullOut, stderr: pullErr } = pullRes;

        // Detect the "would overwrite local changes" error which shows
        // up on stderr — surface it to the popup with a hint.
        const overwriteHint = /Your local changes to the following files would be overwritten/i;
        if (pullRes.exitCode !== 0 || (pullErr && overwriteHint.test(pullErr))) {
            const firstErrorLine = (pullErr || pullRes.error?.message || '').split('\n').find((l) => l.trim()) || 'git pull faalde';
            if (!pullError) pullError = firstErrorLine;
        }

        const lines = [];
        if (fetchRes.stdout.trim()) lines.push('$ git fetch origin', ...fetchRes.stdout.trim().split('\n').map((l) => '  ' + l));
        lines.push('', '$ git pull', ...pullOut.trim().split('\n').map((l) => '  ' + l));
        if (pullErr.trim()) lines.push(...pullErr.trim().split('\n').map((l) => '  ⚠ ' + l));
        if (pullError) lines.push('', '⚠ ' + pullError);

        const success = status === 0 && !pullError;
        log(`git pull ${success ? 'geslaagd' : 'mislukt'}`);

        // Broadcast the result on the WS hub so any connected SPA
        // (desktop, tablet, phone) will reload to pick up the freshly
        // pulled code. The originating tab reloads on its own via
        // updatePopup.startUpdate().
        const broadcastMsg = pullError || (success ? 'git pull voltooid.' : 'git pull had fouten.');
        if (success) {
            try { wsBroadcast('app:update', { state: 'pulled', success: true }); } catch { /* hub gone */ }
        } else {
            try { wsBroadcast('app:update', { state: 'failed', success: false, message: broadcastMsg }); } catch { /* hub gone */ }
        }

        res.json({
            success,
            exit_code: status,
            output: lines.join('\n'),
            message: broadcastMsg,
        });
    } catch (err) {
        if (err.killed) {
            try { wsBroadcast('app:update', { state: 'failed', success: false, message: 'Git pull timeout' }); } catch { /* */ }
            res.status(504).json({ success: false, output: 'Timeout: git pull duurde langer dan 30 seconden.', message: 'Git pull timeout.' });
        } else if (err.code === 'ENOENT') {
            try { wsBroadcast('app:update', { state: 'failed', success: false, message: 'Git niet gevonden' }); } catch { /* */ }
            res.json({ success: false, output: 'Git is niet geïnstalleerd.', message: 'Git niet gevonden.' });
        } else {
            try { wsBroadcast('app:update', { state: 'failed', success: false, message: err.message }); } catch { /* */ }
            const code = err.code || 1;
            res.status(500).json({ success: false, exit_code: code, output: err.message, message: 'Onverwachte fout.' });
        }
    }
});

// ── Update Checking ────────────────────────────────────────────────────

router.get('/check-update', async (req, res) => {
    try {
        const payload = await checkGitUpdates();
        res.json(payload);
    } catch (err) {
        res.json({ update_available: false, behind_count: 0, error: err.message?.slice(0, 200) });
    }
});

// Reusable: probe git + collect changelog. Used by both the REST endpoint
// and the WebSocket broadcaster (startUpdatePolling below).
export async function checkGitUpdates() {
    const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT_DIR, timeout: 10_000 });
    const branch = branchOut.trim();

    await execFileAsync('git', ['fetch', 'origin'], { cwd: ROOT_DIR, timeout: 30_000 });

    const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', `HEAD..origin/${branch}`], { cwd: ROOT_DIR, timeout: 10_000 });
    const count = parseInt(countOut.trim(), 10) || 0;

    let commits = [];
    let latest_tag = null;
    let head_remote = null;
    if (count > 0) {
        try {
            const { stdout: logOut } = await execFileAsync(
                'git',
                ['log', '--pretty=format:%H%n%h%n%s%n%an%n%aI%n---', `HEAD..origin/${branch}`, '-n', '15'],
                { cwd: ROOT_DIR, timeout: 10_000 }
            );
            commits = parseCommitLog(logOut);
            head_remote = commits[0]?.hash || null;
        } catch { /* non-fatal */ }

        try {
            const { stdout: tagOut } = await execFileAsync(
                'git',
                ['describe', '--tags', '--abbrev=0', `origin/${branch}`],
                { cwd: ROOT_DIR, timeout: 5_000 }
            );
            latest_tag = tagOut.trim() || null;
        } catch { /* no tags on this branch yet */ }
    }

    let current_version = UPDATE_CONFIG.current_version;
    let version_name = 'Ichtus Workspace';
    try {
        const verPath = path.join(ROOT_DIR, 'Ichtus_SPA', 'version.json');
        if (existsSync(verPath)) {
            const v = JSON.parse(readFileSync(verPath, 'utf-8'));
            if (v.version) current_version = v.version;
            if (v.name) version_name = v.name;
        }
    } catch { /* fall back to hardcoded */ }

    return {
        update_available: count > 0,
        behind_count: count,
        branch,
        current_version,
        version_name,
        latest_tag,
        head_remote,
        commits,
        checked_at: new Date().toISOString(),
    };
}

// Parse the block-delimited output of: %H\n%h\n%s\n%an\n%aI\n---
function parseCommitLog(raw) {
    if (!raw || !raw.trim()) return [];
    return raw.split('\n---\n').filter(Boolean).map((block) => {
        const [hash, short, subject, author, iso] = block.split('\n');
        return {
            hash: (hash || '').trim(),
            short: (short || '').trim(),
            subject: (subject || '').trim(),
            author: (author || '').trim(),
            date: (iso || '').trim(),
        };
    });
}

// ── Update Polling + WS Broadcast ─────────────────────────────────────
//
// Polls the remote every `intervalMs` and broadcasts an `app:update`
// event on the WebSocket hub if commits have appeared since the last
// broadcast. The SPA listens for that event in ws-client.js and shows
// the modal in js/modules/update-popup.js — no separate REST poll needed
// on every connected device.
let _pollingTimer = null;
let _lastBroadcastSha = null;
let _pollingInFlight = false;

export function startUpdatePolling(broadcast, intervalMs = 5 * 60 * 1000) {
    if (typeof broadcast !== 'function') {
        log('[update-polling] startUpdatePolling: broadcast is not a function, skipping');
        return;
    }
    if (_pollingTimer) {
        log('[update-polling] already running');
        return;
    }

    const tick = async () => {
        if (_pollingInFlight) return;
        _pollingInFlight = true;
        try {
            const payload = await checkGitUpdates();
            if (payload.update_available && payload.head_remote) {
                if (payload.head_remote !== _lastBroadcastSha) {
                    _lastBroadcastSha = payload.head_remote;
                    log(`[update-polling] broadcasting app:update @ ${payload.head_remote.slice(0, 7)} (${payload.behind_count} commits)`);
                    try { broadcast('app:update', payload); } catch { /* hub gone */ }
                }
            } else {
                _lastBroadcastSha = null;
            }
        } catch (err) {
            log(`[update-polling] check failed: ${err.message?.slice(0, 120)}`);
        } finally {
            _pollingInFlight = false;
        }
    };

    setTimeout(tick, 30_000);
    _pollingTimer = setInterval(tick, intervalMs);
    log(`[update-polling] gestart — interval ${intervalMs / 1000}s`);
}

export function stopUpdatePolling() {
    if (_pollingTimer) {
        clearInterval(_pollingTimer);
        _pollingTimer = null;
        _lastBroadcastSha = null;
    }
}

// ── Service Restart (minimalistic — signals NSSM or self) ──────────────

router.post('/restart/:key', async (req, res) => {
    const { key } = req.params;
    log(`restart requested for: ${key}`);
    // In NSSM context, nssm restart IchtusServer is run externally
    // (e.g. from the supervisor UI). NSSM handles the actual restart.
    res.json({ success: true, message: `Restart ${key} aangevraagd. NSSM handelt het af.` });
});

router.post('/restart-all', async (req, res) => {
    log('restart-all requested');
    res.json({ success: true, message: 'Alle services worden herstart door NSSM.' });
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
