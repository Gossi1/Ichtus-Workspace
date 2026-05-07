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

// Keep fullscreenchange listener for updating button state
document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('btn-global-fullscreen');
    if (btn) {
        if (document.fullscreenElement) {
            btn.classList.add('active');
            btn.title = 'Exit Fullscreen';
        } else {
            btn.classList.remove('active');
            btn.title = 'Toggle Fullscreen';
        }
    }
});

console.log('Ichtus Workspace SPA ready.');