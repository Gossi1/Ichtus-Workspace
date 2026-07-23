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

// Hide splash screen — smooth fade-out via JS (overrides CSS auto-hide)
window.hideSplash = function() {
    var splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(function() {
            if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 450);
    }
};

// Hide splash: app.js is the last script, so DOM is fully ready
hideSplash();

// Start the background update checker (polls supervisor every 5 min)
if (window.updateChecker) {
    // Delay first check to let the app fully initialize
    setTimeout(function() { window.updateChecker.start(); }, 5000);
}

console.log('Ichtus Workspace SPA ready.');