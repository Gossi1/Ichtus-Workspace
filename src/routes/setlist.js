/**
 * Setlist Service Templates Routes
 *
 * Persists service templates to `Ichtus_SPA/data/setlist-templates.json` on disk.
 * Allows templates to be shared across all devices and kept in git.
 */

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { broadcast } from '../ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');
const DATA_DIR = resolve(ROOT_DIR, 'Ichtus_SPA', 'data');
const TEMPLATES_FILE = resolve(DATA_DIR, 'setlist-templates.json');

const router = Router();

function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * GET /api/setlist/templates
 * Returns current setlist templates from file
 */
router.get('/templates', (req, res) => {
    try {
        ensureDataDir();
        if (!existsSync(TEMPLATES_FILE)) {
            return res.status(404).json({
                success: false,
                error: 'Template file not found'
            });
        }

        const raw = readFileSync(TEMPLATES_FILE, 'utf-8');
        const templates = JSON.parse(raw);
        res.json({ success: true, templates });
    } catch (err) {
        console.error('  [SETLIST] Error reading templates file:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/setlist/templates
 * Saves updated templates to setlist-templates.json
 */
router.post('/templates', (req, res) => {
    try {
        const templates = req.body;
        if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
            return res.status(400).json({ success: false, error: 'Invalid payload: expected an object of templates.' });
        }

        // Validate basic structure
        for (const [key, tpl] of Object.entries(templates)) {
            if (!tpl || typeof tpl !== 'object' || typeof tpl.name !== 'string' || !Array.isArray(tpl.items)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid template structure for key "${key}". Expected { name: string, items: array }.`
                });
            }
        }

        ensureDataDir();
        writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf-8');
        console.log(`  [SETLIST] Templates saved to ${TEMPLATES_FILE} (${Object.keys(templates).length} templates)`);

        // Notify connected clients via WebSocket
        try {
            broadcast('setlist:templates', { templates });
        } catch (_) {}

        res.json({ success: true, count: Object.keys(templates).length });
    } catch (err) {
        console.error('  [SETLIST] Error saving templates file:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
