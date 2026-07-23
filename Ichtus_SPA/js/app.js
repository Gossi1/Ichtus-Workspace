/* ============================================
   SPA MAIN APPLICATION
   Entry point and initialization
   ============================================ */

// Global fullscreen toggle function (called from onclick attribute)
window.toggleFullscreen = function() {
    console.log('toggleFullscreen() called');
    if (!document.fullscreenElement) {
        console.log('Requesting fullscreen...');
        document.documentElement.requestFullscreen().catch(err => {
            console.log('Error enabling fullscreen: ' + err.message);
        });
    } else {
        console.log('Exiting fullscreen...');
        if (document.exitFullscreen) document.exitFullscreen();
    }
};

// Make modules globally available for onclick handlers
window.agendaModule = agendaModule;
window.checklistModule = checklistModule;
window.setlistModule = setlistModule;
window.patchbayModule = patchbayModule;
window.analyticsModule = analyticsModule;
window.router = router;

// Make NDI module globally available
window.ndiModule = ndiModule;

// Keep fullscreenchange listener for updating button state
document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('btn-global-fullscreen');        if (btn) {
            if (document.fullscreenElement) {
                btn.classList.add('active');
                btn.title = __('fullscreen_exit');
            } else {
                btn.classList.remove('active');
                btn.title = __('fullscreen_enter');
            }
        }
});

// Hide splash screen — minimaal 1s zichtbaar, daarna vloeiende fade-out
window.hideSplash = function() {
    var splash = document.getElementById('splash-screen');
    if (!splash) return;

    // Bereken hoelang de splash al zichtbaar is
    var elapsed = Date.now() - (window._splashLoadedAt || Date.now());
    var minDelay = Math.max(0, 1000 - elapsed);

    setTimeout(function() {
        // Cancel CSS animation + start fade-out in dezelfde frame
        splash.style.animation = 'none';
        splash.classList.add('fade-out');

        // DOM verwijderen na de fade-out transition (0.4s in CSS)
        setTimeout(function() {
            if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 500);
    }, minDelay);
};

// Splash verbergen — app.js is het laatste script, DOM is volledig geladen
hideSplash();

// Start the background update checker (polls supervisor every 5 min)
if (window.updateChecker) {
    // Delay first check to let the app fully initialize
    setTimeout(function() { window.updateChecker.start(); }, 5000);
}

console.log('Ichtus Workspace SPA ready.');