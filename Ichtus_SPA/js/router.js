// SPA Router for Ichtus Workspace
const router = {
    currentView: null,
    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Sidebar element (used by mobile hamburger; desktop toggle is handled by shared-assets/js/sidebar.js)
        const sidebar = document.getElementById('ichtus-sidebar');

        // Mobile hamburger menu toggle - set up BEFORE navigate() for robustness
        const hamburger = document.getElementById('mobile-hamburger');
        const backdrop = document.getElementById('sidebar-backdrop');
        if (hamburger && backdrop && sidebar) {
            const openMobileSidebar = () => {
                sidebar.classList.add('mobile-open');
                sidebar.classList.add('collapsed');
                hamburger.classList.add('open');
                backdrop.classList.add('visible');
                document.body.style.overflow = 'hidden';
            };
            const closeMobileSidebar = () => {
                sidebar.classList.remove('mobile-open');
                hamburger.classList.remove('open');
                backdrop.classList.remove('visible');
                document.body.style.overflow = '';
            };

            hamburger.addEventListener('click', () => {
                if (sidebar.classList.contains('mobile-open')) {
                    closeMobileSidebar();
                } else {
                    openMobileSidebar();
                }
            });

            backdrop.addEventListener('click', closeMobileSidebar);

            // Close mobile sidebar when a nav link is clicked
            sidebar.querySelectorAll('.sidebar-menu a').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth <= 768) {
                        closeMobileSidebar();
                    }
                });
            });
        }

        // Handle initial hash or default view
        const hash = window.location.hash.replace('#', '');
        const initialView = (hash && ['agenda', 'checklist', 'patchbay', 'analytics', 'setlist', 'dashboard', 'ndi', 'settings'].includes(hash)) ? hash : 'dashboard';
        
        this.navigate(initialView);
        
        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '');
            const view = (hash && ['agenda', 'checklist', 'patchbay', 'analytics', 'setlist', 'dashboard', 'ndi', 'settings'].includes(hash)) ? hash : 'dashboard';
            if (view !== this.currentView) {
                this.navigate(view, false);
            }
        });
    },

    navigate(view, updateHash = true) {
        // Skip if already on this view and not forcing navigation
        if (view === this.currentView && updateHash === false) return;

        // Clean up Patchbay sidebar when navigating away
        if (this.currentView === 'patchbay') {
            const pbSidebar = document.getElementById('pb-sidebar');
            if (pbSidebar) pbSidebar.classList.remove('open');
            document.body.classList.remove('pb-sidebar-open');
        }

        // Clean up NDI module when navigating away
        if (this.currentView === 'ndi' && typeof ndiModule !== 'undefined' && ndiModule.cleanup) {
            ndiModule.cleanup();
        }

        // Hide all views
        document.querySelectorAll('.app-view').forEach(v => v.classList.remove('active'));

        // Show target view
        const targetView = document.getElementById(`view-${view}`);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
        }

        // Update sidebar active state
        document.querySelectorAll('.sidebar-menu li').forEach(li => {
            li.classList.remove('active');
            if (li.dataset.view === view) {
                if (view === 'dashboard') {
                    const layoutAttr = li.dataset.layout;
                    const activeLayout = typeof dashboardModule !== 'undefined' ? dashboardModule.getActiveLayoutName() : '__default__';
                    if (layoutAttr === activeLayout) {
                        li.classList.add('active');
                    }
                } else {
                    li.classList.add('active');
                }
            }
        });

        this.currentView = view;

        // Update URL hash (only if not already on correct hash)
        if (updateHash && window.location.hash !== `#${view}`) {
            window.location.hash = view;
        }

        // Initialize module for the view
        if (view === 'agenda' && typeof agendaModule !== 'undefined') {
            agendaModule.init();
        } else if (view === 'checklist' && typeof checklistModule !== 'undefined') {
            checklistModule.init();
        } else if (view === 'patchbay' && typeof patchbayModule !== 'undefined') {
            patchbayModule.init();
        } else if (view === 'analytics' && typeof analyticsModule !== 'undefined') {
            analyticsModule.init();
        } else if (view === 'setlist' && typeof setlistModule !== 'undefined') {
            setlistModule.init();
        } else if (view === 'dashboard' && typeof dashboardModule !== 'undefined') {
            dashboardModule.init();
        } else if (view === 'ndi' && typeof ndiModule !== 'undefined') {
            ndiModule.init();
        } else if (view === 'settings' && typeof settingsModule !== 'undefined') {
            settingsModule.init();
        }
    }
};

// Initialize router when DOM is ready
document.addEventListener('DOMContentLoaded', () => router.init());