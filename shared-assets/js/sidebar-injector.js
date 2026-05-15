// sidebar-injector.js
document.addEventListener('DOMContentLoaded', () => {
    const sidebarPlaceholder = document.getElementById('sidebar-placeholder');
    if (!sidebarPlaceholder) return;

    // The standardized HTML for your suite
    const sidebarHTML = `
    <nav class="ichtus-sidebar" id="ichtus-sidebar">
        <div class="sidebar-header">
            <img src="../shared-assets/images/Ichtus logo oranje.png" alt="Logo" class="sidebar-logo">
            <span class="sidebar-title">WORKSPACE</span>
        </div>
        <ul class="sidebar-menu">
            <li data-app="agenda"><a href="../Agenda/index.html"><div class="sidebar-icon"><svg class="sidebar-nav-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg></div><span class="sidebar-text">Agenda</span></a></li>
            <li data-app="checklist"><a href="../Checklist/index.html"><div class="sidebar-icon"><svg class="sidebar-nav-icon"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg></div><span class="sidebar-text">Checklist</span></a></li>
            <li data-app="analytics"><a href="../ProPresenter/index.html"><div class="sidebar-icon"><svg class="sidebar-nav-icon"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg></div><span class="sidebar-text">Analytics</span></a></li>
            <li data-app="patchbay"><a href="../Patchbay/index.html"><div class="sidebar-icon"><svg class="sidebar-nav-icon"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg></div><span class="sidebar-text">Patchbay</span></a></li>
            <li data-app="setlists"><a href="../Setlist_maker/index.html"><div class="sidebar-icon"><svg class="sidebar-nav-icon" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg></div><span class="sidebar-text">Setlists</span></a></li>
        </ul>
    </nav>`;

    sidebarPlaceholder.innerHTML = sidebarHTML;

    // Automatically highlight the active app based on the body's data-app attribute
    const currentApp = document.body.getAttribute('data-app');
    if (currentApp) {
        const activeLink = sidebarPlaceholder.querySelector(`[data-app="${currentApp}"]`);
        if (activeLink) activeLink.classList.add('active');
    }
});