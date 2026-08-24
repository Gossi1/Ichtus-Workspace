/**
 * Ichtus Workspace — Consolidated Server
 *
 * Eén Express server op poort 8080 die alles bedient:
 * - SPA static files (Ichtus_SPA/)
 * - System API (NDI, Tockify, git, library)
 * - X32 OSC bridge
 * - Mic/IEM monitor (server state + WebSocket)
 * - WebSocket realtime hub
 *
 * Vervangt: server.py + x32/server.js + mic-iem-server/server.js + supervisor.py
 *
 * Start:  node src/server.js
 * NSSM:   install-service.bat   (registers "IchtusServer" Windows service)
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';

// ── Internal modules ───────────────────────────────────────────────────
import { initFirebaseAdmin, getFirestore } from './lib/firebase.js';
// (consolidated elsewhere)
import { initWebSocket, broadcast } from './ws.js';
import systemRoutes, { initUpdateChecker } from './routes/system.js';
import x32Routes from './routes/x32.js';
import iemRoutes, { initIemState, iemStateFileExists } from './routes/iem.js';
import worshiptoolsRoutes from './routes/worshiptools.js';
import commandCenterRoutes, { initCommandCenterTopic } from './routes/commandcenter.js';
import patchbayRoutes, { initPatchbayTopic } from './routes/patchbay-state.js';
import dashboardRoutes, { initDashboardTopic } from './routes/dashboard-state.js';

// ── Paths ──────────────────────────────────────────────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const SPA_DIR = resolve(ROOT_DIR, 'Ichtus_SPA');

// ── Local config (niet op GitHub) ─────────────────────────────────────
// Kopieer server-config.example.json → server-config.json en vul je waarden in.
// Environment variables have priority over config file.
let localConfig = {};
try {
    const configPath = resolve(ROOT_DIR, 'server-config.json');
    if (existsSync(configPath)) {
        localConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        console.log('  [CONFIG] server-config.json geladen');
    }
} catch (_) {}

const PORT = parseInt(process.env.PORT, 10) || localConfig.port || 8080;
const HOST = process.env.HOST || localConfig.host || '0.0.0.0';

// ── Express App ────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Request logging ────────────────────────────────────────────────────
app.use((req, res, next) => {
    const path = req.path.split('?')[0];
    if (!path.startsWith('/api/health')) { // skip noisy health checks
        console.log(`  ${req.method} ${path}`);
    }
    next();
});

// ── API Routes ─────────────────────────────────────────────────────────
// System routes op /api/* (NDI, Tockify, git, library, health, status)
app.use('/api', systemRoutes);

// X32 OSC bridge op /api/x32/*
app.use('/api/x32', x32Routes);

// Mic/IEM monitor op /api/iem/*
app.use('/api/iem', iemRoutes);

// WorshipTools data sync op /api/worshiptools/*
app.use('/api/worshiptools', worshiptoolsRoutes);

// Command Center (local-first + cloud backup) op /api/commandcenter/*
app.use('/api/commandcenter', commandCenterRoutes);

// Patchbay / dashboard cloud sync (local-first + cloud backup)
app.use('/api/patchbay', patchbayRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ── Firebase config injection middleware ────────────────────────────────
// Serveert HTML bestanden met Firebase config injected voor </head>
app.use((req, res, next) => {
    // Alleen HTML bestanden en root
    const urlPath = req.path;
    const isRoot = urlPath === '/' || urlPath === '';
    const isHTML = extname(urlPath) === '.html' || urlPath.endsWith('.html');

    if (!isRoot && !isHTML) return next();

    // Bepaal bestandspad
    let filePath;
    if (isRoot || urlPath === '/' || urlPath === '') {
        filePath = join(SPA_DIR, 'index.html');
    } else if (urlPath.startsWith('/Ichtus_SPA/')) {
        filePath = join(ROOT_DIR, urlPath);
    } else {
        // Relative pad vanuit SPA context
        filePath = join(SPA_DIR, urlPath);
    }

    // Check of het een directory is → index.html
    try {
        if (statSync(filePath).isDirectory()) {
            filePath = join(filePath, 'index.html');
        }
    } catch (_) {}

    if (!existsSync(filePath)) return next();

    try {
        const content = readFileSync(filePath, 'utf-8');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.send(content);
    } catch (err) {
        res.status(500).send(`Fout bij het laden: ${err.message}`);
    }
});

// ── Static files ───────────────────────────────────────────────────────
// Serveer de hele project-root als static (behalve src/, node_modules/)
app.use(express.static(ROOT_DIR, {
    index: false, // We handelen index.html hierboven af
    setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    },
}));

// ── Fallback naar SPA ──────────────────────────────────────────────────
app.get('*', (req, res) => {
    // API-padres niet vangen — die worden al afgehandeld door hun eigen routers
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    // Probeer SPA index.html
    const indexPath = join(SPA_DIR, 'index.html');
    if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(content);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// ── HTTP Server + WebSocket ────────────────────────────────────────────
const server = createServer(app);
initWebSocket(server);

// Check for remote updates on startup and when triggered by webhook / WS.
// Connected SPA clients surface the popup when a new HEAD is detected.
initUpdateChecker(broadcast);

// ── Opt-in migratie: oude mic_monitor Firestore docs → iem-state.json ──
// De mic/IEM monitor praat al niet meer met Firestore; iem-state.json is de
// enige bron. Deze migratie is daardoor opt-in (env IEM_MIGRATE_FROM_FIRESTORE=1)
// en draait alleen als er nog geen lokaal state-bestand bestaat — bedoeld voor
// oude installaties die hun Firestore-data eenmalig willen overnemen.
//
// Let op: de migratie is read-only. De oude mic_monitor/{config, live_status,
// x32_library} docs blijven daarna onaangeroerd in Firestore staan (niets
// schrijft er meer naar); verwijder ze handmatig via de Firebase Console.
async function migrateIemStateFromFirestore() {
    if (process.env.IEM_MIGRATE_FROM_FIRESTORE !== '1') return null;
    if (iemStateFileExists()) return null; // nieuwere lokale state heeft voorrang
    const firestore = getFirestore();
    if (!firestore) return null;

    const seed = {};
    try {
        const cfg = await firestore.collection('mic_monitor').doc('config').get();
        if (cfg.exists && Array.isArray(cfg.data().hardware)) seed.hardware = cfg.data().hardware;

        const status = await firestore.collection('mic_monitor').doc('live_status').get();
        if (status.exists && Array.isArray(status.data().channels)) seed.channels = status.data().channels;

        const lib = await firestore.collection('mic_monitor').doc('x32_library').get();
        if (lib.exists) {
            const d = lib.data();
            if (d && d.map) seed.x32Library = d.map;
            if (d && d.lastUpdated) seed.x32LastUpdated = d.lastUpdated;
        }

        if (seed.hardware || seed.channels || seed.x32Library) {
            console.log('  [IEM] Firestore → iem-state.json migratie voorbereid');
            return seed;
        }
    } catch (err) {
        console.warn('  [IEM] Migratie uit Firestore mislukt (defaults worden gebruikt):', err.message);
    }
    return null;
}

// ── Start ──────────────────────────────────────────────────────────────
async function start() {
    // Firebase Admin initialisatie
    const firebaseOk = initFirebaseAdmin();

    // Mic/IEM state: lokaal bestand, opt-in Firestore-migratie (env flag), of defaults
    const iemSeed = await migrateIemStateFromFirestore();
    initIemState(iemSeed);

    // Local-first topics: state laden uit Firestore-backup (of leeg als er geen is)
    await Promise.all([
        initCommandCenterTopic(),
        initPatchbayTopic(),
        initDashboardTopic(),
    ]);

    // Server starten
    server.listen(PORT, HOST, () => {
        // Bepaal lokale IP
        let localIP = '127.0.0.1';
        try {
            const nets = networkInterfaces();
            for (const name of Object.keys(nets)) {
                for (const net of nets[name]) {
                    if (net.family === 'IPv4' && !net.internal) {
                        localIP = net.address;
                        break;
                    }
                }
                if (localIP !== '127.0.0.1') break;
            }
        } catch (_) {}

        console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║        ICHTUS WORKSPACE — CONSOLIDATED SERVER       ║
  ╠══════════════════════════════════════════════════════╣
  ║  Lokaal:    http://localhost:${PORT}/Ichtus_SPA/         ║
  ║  Netwerk:   http://${localIP}:${PORT}/Ichtus_SPA/        ║
  ║  Root:      ${ROOT_DIR.slice(-35).padEnd(35)} ║
  ╠══════════════════════════════════════════════════════╣
  ║  API Endpoints:                                      ║
  ║    /api/health            - Health check             ║
  ║    /api/status            - Status + logs            ║
  ║    /api/ndi/sources       - NDI discovery            ║
  ║    /api/tockify/ics       - Tockify ICS proxy        ║
  ║    /api/library/*         - Song ID library          ║
  ║    /api/x32/*             - X32 OSC bridge           ║
  ║    /api/iem/*             - Mic/IEM monitor          ║
  ║    /api/system/check-update - Git update check       ║
  ║    /ws                    - WebSocket hub            ║
  ╠══════════════════════════════════════════════════════╣
  ║  Firebase: ${firebaseOk ? 'Verbonden ✓' : 'NIET VERBONDEN ✗ — serviceAccountKey.json ontbreekt'}            ║
  ║  WebSocket: Actief op /ws                            ║
  ╠══════════════════════════════════════════════════════╣
  ║  Druk Ctrl+C om te stoppen                           ║
  ╚══════════════════════════════════════════════════════╝
        `);
    });
}

// ── Graceful shutdown ──────────────────────────────────────────────────
async function shutdown(signal) {
    console.log(`\n  [SHUTDOWN] ${signal} ontvangen — servers sluiten…`);

    try {
        const { shutdownX32 } = await import('./routes/x32.js');
        await shutdownX32();
    } catch (_) {}

    server.close(() => {
        console.log('  [SHUTDOWN] Klaar. Tot ziens!');
        process.exit(0);
    });

    // Force exit na 5 seconden
    setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
if (process.platform === 'win32') {
    process.on('SIGBREAK', () => shutdown('SIGBREAK'));
}

// ── Launch ─────────────────────────────────────────────────────────────
start().catch((err) => {
    console.error('  [FATAL] Server kon niet starten:', err);
    process.exit(1);
});
