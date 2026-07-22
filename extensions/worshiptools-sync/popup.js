/* ============================================
   Ichtus Extension Popup
   Shows update status + Git Pull button
   ============================================ */

// ───── DOM refs ─────
const extVersionEl  = document.getElementById('ext-version');
const updateDot     = document.getElementById('update-dot');
const updateStatus  = document.getElementById('update-status');
const serverVersion = document.getElementById('server-version');
const serverUrlInput = document.getElementById('server-url');
const btnTest       = document.getElementById('btn-test-server');
const btnGitPull    = document.getElementById('btn-git-pull');
const btnIcon       = document.getElementById('btn-icon');
const btnText       = document.getElementById('btn-text');
const outputArea    = document.getElementById('output-area');
const linkReleases  = document.getElementById('open-releases');
const linkExt       = document.getElementById('open-chrome-ext');

/** Read a key directly from chrome.storage.session (popup has same permissions as background) */
async function sessionRead(key) {
  try {
    const result = await chrome.storage.session.get(key);
    return result[key] ?? null;
  } catch (_) {
    return null;
  }
}

/** Append a line to the output area, optionally styled */
function appendOutput(text, className) {
  const line = document.createElement('div');
  line.textContent = text;
  if (className) line.className = className;
  outputArea.appendChild(line);
  outputArea.scrollTop = outputArea.scrollHeight;
}

function clearOutput() {
  outputArea.innerHTML = '';
}

function setButtonPulling(pulling) {
  btnGitPull.disabled = pulling;
  btnGitPull.classList.toggle('pulling', pulling);
  btnIcon.textContent = pulling ? '⏳' : '⬇';
  btnText.textContent = pulling ? 'Git Pull bezig...' : 'Git Pull';
}

// ───── Initialize ─────

async function init() {
  // Show extension version
  const manifest = chrome.runtime.getManifest();
  extVersionEl.textContent = 'v' + (manifest.version || '?');

  // Read update status directly from chrome.storage.session
  const latest = await sessionRead('latestAvailableVersion');
  const releaseUrl = await sessionRead('latestReleaseUrl');

  if (latest && releaseUrl) {
    updateDot.className = 'status-dot warning';
    updateStatus.textContent = '📦 Update beschikbaar: v' + latest;
  } else {
    updateDot.className = 'status-dot online';
    updateStatus.textContent = 'Up-to-date (v' + (manifest.version || '?') + ')';
  }

  // Probe server status
  await probeServerStatus();
}

async function probeServerStatus() {
  const base = serverUrlInput.value.replace(/\/+$/, '');
  try {
    const resp = await fetch(base + '/api/status', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json();
      const ver = data.version || '?';
      serverVersion.textContent = 'v' + ver + ' (online)';
      serverVersion.style.color = '#34d399';
    } else {
      serverVersion.textContent = 'Fout: HTTP ' + resp.status;
      serverVersion.style.color = '#f87171';
    }
  } catch (err) {
    serverVersion.textContent = 'Niet bereikbaar';
    serverVersion.style.color = '#f87171';
  }
}

// ───── Git Pull ─────

async function handleGitPull() {
  const base = serverUrlInput.value.replace(/\/+$/, '');
  clearOutput();
  appendOutput('$ git fetch origin && git pull');
  appendOutput('  Verbinden met ' + base + '/api/update ...');
  setButtonPulling(true);

  try {
    const resp = await fetch(base + '/api/update', {
      method: 'POST',
      signal: AbortSignal.timeout(60000) // 60s timeout for slow git
    });
    const data = await resp.json();

    // Show output
    if (data.output) {
      data.output.split('\n').forEach(line => {
        appendOutput(line);
      });
    }

    // Show success/error
    if (data.success) {
      appendOutput('');
      appendOutput('✅ ' + (data.message || 'git pull voltooid.'), 'success');
      appendOutput('');
      appendOutput('⚠️  Herlaad de extensie in chrome://extensions (🔄)', 'error');
      appendOutput('   en ververs de SPA pagina om de nieuwe code te gebruiken.');
    } else {
      appendOutput('');
      appendOutput('❌ ' + (data.message || 'git pull mislukt.'), 'error');
    }

    // Re-probe server version after pull
    await probeServerStatus();

  } catch (err) {
    if (err.name === 'TimeoutError') {
      appendOutput('  ⚠ Timeout: server reageert niet binnen 60 seconden.', 'error');
    } else {
      appendOutput('  ⚠ Fout: ' + (err.message || String(err)), 'error');
    }
    appendOutput('');
    appendOutput('❌ Kan geen verbinding maken met de server.', 'error');
  } finally {
    setButtonPulling(false);
  }
}

// ───── Test server connection ─────

async function handleTestServer() {
  const btnTextOrig = btnTest.textContent;
  btnTest.textContent = 'Bezig...';
  btnTest.disabled = true;
  await probeServerStatus();
  btnTest.textContent = btnTextOrig;
  btnTest.disabled = false;
}

// ───── Events ─────

btnGitPull.addEventListener('click', handleGitPull);
btnTest.addEventListener('click', handleTestServer);

serverUrlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') handleGitPull();
});

linkReleases.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://github.com/Gossi1/Ichtus-Workspace/releases' });
});

linkExt.addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions' });
});

// ───── Kick off ─────
init();
