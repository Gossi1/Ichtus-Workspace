// Ichtus Sidebar — Collapse / Expand

let sidebarInitialized = false;

function toggleSidebar() {
    const sidebar = document.getElementById('ichtus-sidebar');
    const body = document.body;
    if (!sidebar) return;

    const isCollapsed = sidebar.classList.toggle('collapsed');
    body.classList.toggle('sidebar-collapsed', isCollapsed);
    localStorage.setItem('ichtus_sidebar_collapsed', isCollapsed ? 'true' : 'false');
}

function initSidebar() {
    if (sidebarInitialized) return;
    sidebarInitialized = true;

    const sidebar = document.getElementById('ichtus-sidebar');
    if (!sidebar) return;

    // Restore collapsed state from localStorage
    const saved = localStorage.getItem('ichtus_sidebar_collapsed');
    if (saved === 'true') {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
    }

    // Mobile hamburger toggle
    const hamburger = document.getElementById('mobile-hamburger');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (hamburger && backdrop) {
        hamburger.addEventListener('click', () => {
            const isOpen = sidebar.classList.contains('mobile-open');
            sidebar.classList.toggle('mobile-open', !isOpen);
            hamburger.classList.toggle('open', !isOpen);
            backdrop.classList.toggle('visible', !isOpen);
            document.body.style.overflow = isOpen ? '' : 'hidden';
        });

        backdrop.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            hamburger.classList.remove('open');
            backdrop.classList.remove('visible');
            document.body.style.overflow = '';
        });

        // Close on nav link click (mobile only)
        sidebar.querySelectorAll('.sidebar-menu a').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    sidebar.classList.remove('mobile-open');
                    hamburger.classList.remove('open');
                    backdrop.classList.remove('visible');
                    document.body.style.overflow = '';
                }
            });
        });
    }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}