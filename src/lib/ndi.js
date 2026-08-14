/**
 * NDI Source Discovery
 *
 * Twee methoden:
 * 1. zeroconf mDNS (indien beschikbaar) — zoekt _ndi._tcp.local.
 * 2. Fallback: UDP broadcast op poort 5960/5961 met 'NDI_LIST' packet
 *
 * Resultaten worden gecachet (10 seconden) zodat rapid-fire requests
 * niet steeds opnieuw scannen.
 */

import { createSocket } from 'dgram';

// ── Cache state ────────────────────────────────────────────────────────
let ndiCache = null;
let cacheTimestamp = null;
let scanning = false;

const CACHE_TTL_MS = 10_000; // 10 seconden

// ── zeroconf (lazy import) ─────────────────────────────────────────────
let zeroconfAvailable = null;

async function tryZeroconfDiscovery() {
    if (zeroconfAvailable === false) return [];

    try {
        const { Zeroconf, ServiceBrowser } = await import('zeroconf');
        zeroconfAvailable = true;

        return new Promise((resolve) => {
            const sources = [];
            const zc = new Zeroconf();
            const listener = {
                addService(type, name) {
                    try {
                        const info = zc.getServiceInfo(type, name);
                        if (info && info.addresses && info.addresses.length > 0) {
                            const addr = info.addresses[0];
                            sources.push({
                                name: name.replace('._ndi._tcp.local.', '').replace('._ndi._tcp.', ''),
                                address: addr,
                                port: info.port,
                                type: 'NDI Source',
                                metadata: `Port: ${info.port}`,
                            });
                        }
                    } catch (_) { /* skip individual failures */ }
                },
                removeService() {},
                updateService() {},
            };

            const browser = new ServiceBrowser(zc, '_ndi._tcp.local.', listener);

            // Max 3 seconden wachten op discoveries
            setTimeout(() => {
                try { browser.stop(); } catch (_) {}
                try { zc.destroy(); } catch (_) {}
                resolve(sources);
            }, 3000);
        });
    } catch (err) {
        zeroconfAvailable = false;
        console.log('  ⚠️  zeroconf niet beschikbaar — NDI discovery gebruikt UDP fallback');
        return [];
    }
}

// ── UDP broadcast fallback ─────────────────────────────────────────────
function udpDiscovery() {
    return new Promise((resolve) => {
        const sources = [];
        const discovered = new Set();

        try {
            const sock = createSocket('udp4');
            sock.setBroadcast(true);
            sock.setTimeout(1500);

            sock.on('message', (buf, rinfo) => {
                if (!discovered.has(rinfo.address)) {
                    discovered.add(rinfo.address);
                    sources.push({
                        name: `NDI Device@${rinfo.address}`,
                        address: rinfo.address,
                        port: 5961,
                        type: 'NDI Source (UDP)',
                        metadata: 'Discovered via UDP broadcast',
                    });
                }
            });

            sock.on('error', () => {
                try { sock.close(); } catch (_) {}
                resolve(sources);
            });

            sock.on('timeout', () => {
                try { sock.close(); } catch (_) {}
                resolve(sources);
            });

            const packet = Buffer.from('NDI_LIST');
            sock.send(packet, 0, packet.length, 5961, '255.255.255.255');
            sock.send(packet, 0, packet.length, 5960, '255.255.255.255');
        } catch (_) {
            resolve(sources);
        }
    });
}

// ── Public API ─────────────────────────────────────────────────────────

function cacheAge() {
    if (!cacheTimestamp) return Infinity;
    return Date.now() - cacheTimestamp;
}

/**
 * Discover NDI sources. Returns cached results when fresh (< 10s).
 * Starts a background scan when cache is stale, returns whatever we
 * have so far (possibly empty) and enriches the cache for next request.
 */
export async function discoverNdISources() {
    // Fresh cache — return immediately
    if (ndiCache && !scanning && cacheAge() < CACHE_TTL_MS) {
        return ndiCache;
    }

    // Already scanning — wait and return
    if (scanning) {
        await new Promise((r) => setTimeout(r, 2000));
        return ndiCache || { sources: [], count: 0, scanning: false, timestamp: new Date().toISOString() };
    }

    scanning = true;
    ndiCache = { sources: [], count: 0, timestamp: new Date().toISOString(), scanning: true };

    try {
        let sources = await tryZeroconfDiscovery();
        if (sources.length === 0) {
            sources = await udpDiscovery();
        }

        ndiCache = {
            sources,
            count: sources.length,
            timestamp: new Date().toISOString(),
            scanning: false,
        };
        cacheTimestamp = Date.now();
    } catch (err) {
        console.error('  ⚠️  NDI discovery error:', err.message);
        ndiCache = {
            sources: [],
            count: 0,
            timestamp: new Date().toISOString(),
            scanning: false,
            error: err.message,
        };
    } finally {
        scanning = false;
    }

    return ndiCache;
}
