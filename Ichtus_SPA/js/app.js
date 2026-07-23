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

// Splash cleanup — alleen DOM verwijderen NA de CSS-animatie (1.6s)
// Het tonen/verbergen gebeurt volledig via CSS in <head>
window.hideSplash = function() {
    var splash = document.getElementById('splash-screen');
    if (!splash) return;

    // Luister naar animationend event (cleanste manier)
    function removeSplash() {
        if (splash && splash.parentNode) {
            splash.parentNode.removeChild(splash);
        }
    }

    splash.addEventListener('animationend', removeSplash, { once: true });

    // Fallback: als animationend om een reden niet afvuurt, verwijder na 2s
    setTimeout(removeSplash, 2000);
};

// Start splash cleanup — app.js is het laatste script
hideSplash();

// Start the background update checker (polls supervisor every 5 min)
if (window.updateChecker) {
    // Delay first check to let the app fully initialize
    setTimeout(function() { window.updateChecker.start(); }, 5000);
}

console.log('Ichtus Workspace SPA ready.');