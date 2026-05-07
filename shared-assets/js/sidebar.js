// Sidebar Toggle Logic
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('ichtus-sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    
    if (sidebar && sidebarToggle) {
        if (localStorage.getItem('ichtus_sidebar_collapsed') === 'true') {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        }
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('ichtus_sidebar_collapsed', sidebar.classList.contains('collapsed'));
        });
    }
});