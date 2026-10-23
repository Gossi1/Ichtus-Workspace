#!/usr/bin/env node
/**
 * Ichtus Workspace — Tauri Dev Launcher (`npm run dev`)
 *
 * Launches the native Tauri + Rust Axum application in development mode:
 * - Edits in Ichtus_SPA/ and assets/ trigger instant WebSocket live-reload
 *   (CSS hot-reloads in-place without losing app state; JS/HTML reloads the view).
 * - Service Worker caching is disabled in dev mode.
 * - Keyboard shortcuts in Tauri window: F5 or Ctrl+R.
 * - Rust edits in src-tauri/src/ automatically recompile and restart Tauri.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOCAL_TAURI_JS = resolve(ROOT_DIR, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

console.log('\n  ==================================================');
console.log('       ICHTUS WORKSPACE — TAURI DEV MODE');
console.log('  ==================================================');
console.log('  • Frontend edits (Ichtus_SPA/, assets/) auto-reload');
console.log('    instantly via WebSocket (CSS hot-reloads in place)');
console.log('  • Shortcuts in Tauri window: F5 or Ctrl+R');
console.log('  • Press Ctrl+C here to stop the dev server');
console.log('  ==================================================\n');

// Ensure node, npm, and cargo bins are in PATH even in elevated/admin terminals
const env = { ...process.env };
const nodeDir = dirname(process.execPath);
const pathEntries = [nodeDir];

if (process.platform === 'win32' && process.env.USERPROFILE) {
    pathEntries.push(`${process.env.USERPROFILE}\\.cargo\\bin`);
    pathEntries.push(`${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links`);
}
pathEntries.push(resolve(ROOT_DIR, 'node_modules', '.bin'));

for (const entry of pathEntries) {
    if (!env.PATH?.toLowerCase().includes(entry.toLowerCase())) {
        env.PATH = `${entry};${env.PATH || ''}`;
    }
}

// Prefer local tauri.js directly via node to bypass npx path lookup
const child = existsSync(LOCAL_TAURI_JS)
    ? spawn(process.execPath, [LOCAL_TAURI_JS, 'dev', ...process.argv.slice(2)], {
          cwd: ROOT_DIR,
          stdio: 'inherit',
          env,
      })
    : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tauri', 'dev', ...process.argv.slice(2)], {
          cwd: ROOT_DIR,
          stdio: 'inherit',
          shell: true,
          env,
      });

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
