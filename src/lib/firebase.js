/**
 * Firebase Admin SDK initialisatie (gedeeld door alle routes).
 *
 * Zoekt serviceAccountKey.json in de project-root. Als het bestand
 * ontbreekt of ongeldig is, is `firestore` null en vallen alle
 * Firestore-calls stillem op defaults.
 */

import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..', '..');
const SERVICE_ACCOUNT_PATH = resolve(ROOT_DIR, 'serviceAccountKey.json');

let firestore = null;

export function initFirebaseAdmin() {
    if (!existsSync(SERVICE_ACCOUNT_PATH)) {
        console.log(`
  ╔═══════════════════════════════════════════════════════╗
  ║  FIREBASE SERVICE ACCOUNT NIET GEVONDEN              ║
  ╠═══════════════════════════════════════════════════════╣
  ║  1. Ga naar Firebase Console → Project Settings      ║
  ║  2. Service Accounts → "Generate new private key"    ║
  ║  3. Sla het JSON-bestand op als:                     ║
  ║     serviceAccountKey.json (project root)            ║
  ╚═══════════════════════════════════════════════════════╝
        `);
        return false;
    }

    try {
        const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        }
        firestore = admin.firestore();
        console.log('  [FIREBASE] Admin SDK geïnitialiseerd ✓');
        return true;
    } catch (err) {
        console.error('  [FIREBASE] Initialisatie mislukt:', err.message);
        return false;
    }
}

export function getFirestore() {
    return firestore;
}

export { admin };
