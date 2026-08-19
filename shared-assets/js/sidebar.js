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

    // Restore admin section expanded state
    const adminExpanded = localStorage.getItem('ichtus_admin_expanded');
    if (adminExpanded === 'true') {
        const adminGroup = document.querySelector('.sidebar-admin-group');
        const adminArrow = document.querySelector('.admin-arrow');
        if (adminGroup) adminGroup.classList.add('expanded');
        if (adminArrow) adminArrow.classList.add('expanded');
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

// Admin expandable section. When the sidebar is collapsed, clicking the
// Beheer icon can't surface its dropdown (the items would be off-screen
// with `width: 0` on .sidebar-text). So in that case we redirect to the
// Integraties sub-view directly — same place a user would land by
// expanding and clicking through. When the sidebar is expanded, the
// original toggle behaviour is preserved so the user can still keep
// the dropdown open as a workspace-style menu.
function toggleAdminSection() {
    const sidebar = document.getElementById('ichtus-sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('collapsed');

    if (isCollapsed) {
        // Sidebar is collapsed: skip the dropdown (it would be invisible) and
        // route straight to Integraties.
        if (typeof router !== 'undefined' && router && typeof router.navigate === 'function') {
            router.navigate('integration');
        }
        return;
    }

    const adminGroup = document.querySelector('.sidebar-admin-group');
    const adminArrow = document.querySelector('.admin-arrow');
    if (adminGroup) {
        adminGroup.classList.toggle('expanded');
        if (adminArrow) adminArrow.classList.toggle('expanded');
        localStorage.setItem('ichtus_admin_expanded', adminGroup.classList.contains('expanded') ? 'true' : 'false');
    }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}