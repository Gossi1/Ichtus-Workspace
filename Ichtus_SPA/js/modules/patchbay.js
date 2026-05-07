/* ============================================
   PATCHBAY MODULE
   Digital patchbay for cable management
   ============================================ */

const patchbayModule = (function() {
    // Internal state
    const state = {
        data: { nodes: [], connections: [] },
        projects: {},
        currentProjectId: 'default',
        canvasTransform: { x: 0, y: 0, scale: 1 },
        collapsedGroups: new Set(),
        selectedSidebarItem: null,
        clipboardData: null,
        editMode: localStorage.getItem('patchbay_edit_mode') === 'true',
        // touch drag state for iPad
        touchDragActive: false,
        touchDragElement: null,
        touchDragType: null,
        touchDragId: null,
        touchDragStartX: 0,
        touchDragStartY: 0,
        touchDragGhost: null,
        touchDragLastX: 0,
        touchDragLastY: 0,
        touchDragMoved: false,
        // Sound effects
        _audioContext: null,
        _soundEnabled: localStorage.getItem('patchbay_sound_enabled') !== 'false',
        _lastHoverTarget: null,
        _lastHoverSoundTime: 0,
        // event state
        currentTool: 'select',
        draggedNode: null,
        nodeDragOffset: { x: 0, y: 0 },
        isDraggingCanvas: false,
        startDragOffset: { x: 0, y: 0 },
        isConnecting: false,
        connectionStart: null,
        previewLine: null,
        draggedProjectId: null,
        // pinch zoom
        pinchStartDist: 0,
        pinchStartScale: 1,
        pinchCenterX: 0,
        pinchCenterY: 0,
        // connection selection & reconnection state
        selectedConnectionIndex: null,
        isReconnecting: false,
        reconnectingConnIndex: null,
        reconnectingEnd: null, // 'from' or 'to'
        reconnectingOtherPortEl: null, // the fixed port (not being dragged)
        reconnectingPreviewLine: null,
        reconnectingOriginalConn: null, // store original connection for cancel
        // rectangle selection (marquee) state
        isSelecting: false,
        selectionStartX: 0,
        selectionStartY: 0,
        selectionRect: null, // DOM element for the selection rectangle
        selectedNodes: [], // IDs of currently selected nodes
        // renderer
        transformPending: false,
        initialized: false
    };

    // State getters for external access
    function getData() { return state.data; }
    function getProjects() { return state.projects; }
    function getCurrentProjectId() { return state.currentProjectId; }
    function getCanvasTransform() { return state.canvasTransform; }

    // DOM element references
    let container, nodesContainer, svgCanvas, pbSidebar;

    // ==================== DATA MANAGEMENT ====================

    async function loadData() {
        const savedProjects = localStorage.getItem('patchbay_projects');
        if (savedProjects) {
            try {
                state.projects = JSON.parse(savedProjects);
                state.currentProjectId = localStorage.getItem('patchbay_current_project') || Object.keys(state.projects)[0];
                state.data = state.projects[state.currentProjectId].data;
                console.log('Loaded patchbay projects from local storage.');
            } catch (e) {
                console.error('Failed to parse saved projects.', e);
                await migrateLegacyData();
            }
        } else {
            await migrateLegacyData();
        }
        renderAll();
        renderSidebar();
    }

    async function migrateLegacyData() {
        const legacyData = localStorage.getItem('patchbay_data');
        if (legacyData) {
            try { state.data = JSON.parse(legacyData); } 
            catch(e) { await fetchFromFile(); }
        } else {
            await fetchFromFile();
        }
        state.projects = {
            'default': { id: 'default', name: 'Main Patchbay', group: 'General', data: state.data }
        };
        state.currentProjectId = 'default';
        saveSilent();
    }

    async function fetchFromFile() {
        try {
            const response = await fetch('data/patchbay-data.json');
            if (!response.ok) throw new Error('Network response was not ok');
            state.data = await response.json();
        } catch (e) {
            console.warn('Could not load patchbay-data.json. Displaying empty canvas.', e);
            state.data = { nodes: [], connections: [] };
        }
    }

    function saveData() {
        state.projects[state.currentProjectId].data = state.data;
        localStorage.setItem('patchbay_projects', JSON.stringify(state.projects));
        localStorage.setItem('patchbay_current_project', state.currentProjectId);
    }

    function saveSilent() {
        state.projects[state.currentProjectId].data = state.data;
        localStorage.setItem('patchbay_projects', JSON.stringify(state.projects));
        localStorage.setItem('patchbay_current_project', state.currentProjectId);
    }

    // ==================== RENDERING ====================

    function renderAll() {
        renderNodes();
        requestAnimationFrame(renderConnections);
    }

    function renderNodes() {
        nodesContainer.innerHTML = '';
        state.data.nodes.forEach(node => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'node';
            // Restore selected class if this node was selected
            if (state.selectedNodes.includes(node.id)) {
                nodeEl.classList.add('selected');
            }
            nodeEl.style.left = `${node.x}px`;
            nodeEl.style.top = `${node.y}px`;
            nodeEl.id = `node-${node.id}`;

            let inputsHtml = node.inputs.map((p, i) => `<div class=\"port input\" data-port=\"${i}\"><span class=\"port-label\">${p}</span></div>`).join('');
            let outputsHtml = node.outputs.map((p, i) => `<div class=\"port output\" data-port=\"${i}\"><span class=\"port-label\">${p}</span></div>`).join('');

            nodeEl.innerHTML = `
                <div class=\"node-menu-btn\" data-node-id=\"${node.id}\">⋮</div>
                <div class=\"node-header\">${node.title}</div>
                <div class=\"node-ip\">${node.ip}</div>
                <div class=\"node-ports\">
                    <div class=\"port-group inputs\">${inputsHtml}</div>
                    <div class=\"port-group outputs\">${outputsHtml}</div>
                </div>
            `;
            nodesContainer.appendChild(nodeEl);
        });
    }

    function renderConnections() {
        svgCanvas.innerHTML = '';
        const containerRect = nodesContainer.getBoundingClientRect();

        state.data.connections.forEach((conn, index) => {
            const fromNodeEl = document.getElementById(`node-${conn.from}`);
            const toNodeEl = document.getElementById(`node-${conn.to}`);
            
            if(!fromNodeEl || !toNodeEl) return;

            const fromPorts = fromNodeEl.querySelectorAll('.port.output');
            const toPorts = toNodeEl.querySelectorAll('.port.input');
            
            if(!fromPorts[conn.fromPort] || !toPorts[conn.toPort]) return;

            const fromPort = fromPorts[conn.fromPort];
            const toPort = toPorts[conn.toPort];

            const fromRect = fromPort.getBoundingClientRect();
            const toRect = toPort.getBoundingClientRect();

            const fromX = (fromRect.left - containerRect.left + fromRect.width / 2) / state.canvasTransform.scale;
            const fromY = (fromRect.top - containerRect.top + fromRect.height / 2) / state.canvasTransform.scale;
            const toX = (toRect.left - containerRect.left + toRect.width / 2) / state.canvasTransform.scale;
            const toY = (toRect.top - containerRect.top + toRect.height / 2) / state.canvasTransform.scale;

            const curvature = Math.max(Math.abs(toX - fromX) * 0.5, 50); 
            const d = `M ${fromX} ${fromY} C ${fromX + curvature} ${fromY}, ${toX - curvature} ${toY}, ${toX} ${toY}`;
            
            const midX = (fromX + toX) / 2;
            const midY = (fromY + toY) / 2;

            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            group.setAttribute('class', 'connection-group' + (index === state.selectedConnectionIndex ? ' selected' : ''));
            group.setAttribute('data-index', index);
            group.style.cursor = 'pointer';
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', 'path-line');
            path.setAttribute('data-type', conn.type);
            
            let color = '#cccccc';
            const cType = (conn.cable || conn.type || '').toLowerCase();
            
            if(['video', 'hdmi', 'displayport', 'sdi'].includes(cType)) color = '#9b59b6';
            else if(['audio', 'xlr', 'jack 6.3mm', 'jack 3.5mm', 'speakon'].includes(cType)) color = 'var(--ichtus-green)';
            else if(['network', 'ethernet', 'ndi', 'dante'].includes(cType)) color = 'var(--ichtus-blue)';
            else if(['lighting', 'dmx'].includes(cType)) color = 'var(--ichtus-orange)';
            
            path.setAttribute('stroke', color);
            
            const hitbox = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitbox.setAttribute('d', d);
            hitbox.setAttribute('stroke', 'transparent');
            hitbox.setAttribute('stroke-width', '25'); 
            hitbox.setAttribute('fill', 'none');
            hitbox.style.pointerEvents = 'stroke';
            hitbox.style.cursor = 'pointer';
            
            group.appendChild(path);
            group.appendChild(hitbox);

            const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('x', midX - 60);
            fo.setAttribute('y', midY - 30);
            fo.setAttribute('width', '120');
            fo.setAttribute('height', '60');
            fo.style.pointerEvents = 'none';
            fo.style.overflow = 'visible';

            const uiDiv = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            uiDiv.className = 'conn-ui';
            uiDiv.innerHTML = `
                <div class=\"conn-label\">${conn.cable || conn.type || 'Link'}</div>
                <div class=\"conn-btn-group\">
                    <button class=\"conn-btn edit\" data-index=\"${index}\" title=\"Edit Cable\">⚙️</button>
                    <button class=\"conn-btn delete\" data-index=\"${index}\" title=\"Delete Cable\">🗑️</button>
                </div>
            `;
            fo.appendChild(uiDiv);
            group.appendChild(fo);
            svgCanvas.appendChild(group);
        });
    }

    function updateTransform() {
        nodesContainer.style.transformOrigin = '0 0';
        svgCanvas.style.transformOrigin = '0 0';
        svgCanvas.style.overflow = 'visible';
        
        nodesContainer.style.transform = `translate(${state.canvasTransform.x}px, ${state.canvasTransform.y}px) scale(${state.canvasTransform.scale})`;
        svgCanvas.style.transform = `translate(${state.canvasTransform.x}px, ${state.canvasTransform.y}px) scale(${state.canvasTransform.scale})`;
    }

    // ==================== SIDEBAR ====================

    function switchCanvas(id) {
        if (!state.projects[id]) return;
        saveSilent();
        state.currentProjectId = id;
        state.data = state.projects[id].data;
        
        state.canvasTransform = { x: 0, y: 0, scale: 1 };
        updateTransform();
        renderAll();
        
        // Keep the selected sidebar item set to the newly selected canvas
        // This allows keyboard Delete to work immediately after clicking
        state.selectedSidebarItem = id;
        
        renderSidebar();
    }

    // Update sidebar item selection highlight
    function updateSidebarSelection() {
        document.querySelectorAll('.pb-canvas-item.selected-sidebar, .pb-group-title.selected-sidebar').forEach(el => {
            el.classList.remove('selected-sidebar');
        });
        if (state.selectedSidebarItem) {
            if (state.selectedSidebarItem.startsWith('folder:')) {
                // Folder selection
                const folderName = state.selectedSidebarItem.replace('folder:', '');
                document.querySelectorAll('.pb-group-title').forEach(el => {
                    const nameEl = el.querySelector('span:not(.pb-caret)');
                    if (nameEl && nameEl.innerText === folderName) {
                        el.classList.add('selected-sidebar');
                    }
                });
            } else {
                // Canvas item selection
                const selEl = document.querySelector(`.pb-canvas-item[data-proj-id="${state.selectedSidebarItem}"]`);
                if (selEl) selEl.classList.add('selected-sidebar');
            }
        }
    }
    
    function renderSidebar() {
        const content = document.getElementById('pb-sidebar-content');
        if (!content) return;
        content.innerHTML = '';
        
        const subtitle = document.getElementById('current-canvas-subtitle');
        if (subtitle) {
            subtitle.innerText = `${state.projects[state.currentProjectId].group} / ${state.projects[state.currentProjectId].name}`;
        }
        
        const groups = {};
        Object.values(state.projects).forEach(proj => {
            const g = proj.group || 'General';
            if (!groups[g]) groups[g] = [];
            if (typeof proj.order !== 'number') proj.order = Date.now();
            groups[g].push(proj);
        });

        Object.keys(groups).sort().forEach(groupName => {
            groups[groupName].sort((a, b) => a.order - b.order);

            const groupWrap = document.createElement('div');
            groupWrap.className = 'pb-group-wrap';

            const groupTitle = document.createElement('div');
            groupTitle.className = 'pb-group-title';
            groupTitle.style.display = 'flex';
            groupTitle.style.justifyContent = 'space-between';
            groupTitle.style.alignItems = 'center';
            
            const isCollapsed = state.collapsedGroups.has(groupName);
            
            const caret = document.createElement('span');
            caret.className = 'pb-caret';
            caret.innerText = isCollapsed ? '▶' : '▼';
            caret.onclick = (e) => {
                e.stopPropagation();
                if (isCollapsed) state.collapsedGroups.delete(groupName);
                else state.collapsedGroups.add(groupName);
                renderSidebar();
            };

            const nameSpan = document.createElement('span');
            nameSpan.innerText = groupName;
            nameSpan.style.flex = '1';
            
            // Make folder name editable in edit mode
            nameSpan.className = 'pb-folder-name';
            
            groupTitle.appendChild(caret);
            groupTitle.appendChild(nameSpan);
            
            // Click on folder to select it
            groupTitle.addEventListener('click', (e) => {
                // Ignore clicks on caret (it has its own toggle behavior)
                if (e.target === caret) return;
                
                // Check if double-click for rename
                const now = Date.now();
                if (groupTitle.dataset.lastClick && (now - parseInt(groupTitle.dataset.lastClick)) < 400) {
                    groupTitle.dataset.lastClick = '0';
                    renameFolder(groupName);
                    return;
                }
                groupTitle.dataset.lastClick = now.toString();
                
                // Select this folder
                state.selectedSidebarItem = 'folder:' + groupName;
                updateSidebarSelection();
            });
            
            // Edit folder name when clicked in edit mode
            nameSpan.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                if (!state.editMode) return;
                
                // Prevent caret from toggling when we want to edit
                e.preventDefault();
                
                nameSpan.contentEditable = 'true';
                nameSpan.style.outline = 'none';
                nameSpan.style.borderBottom = '1px solid var(--ichtus-orange)';
                
                // Delay focus to allow mousedown to complete
                setTimeout(() => {
                    nameSpan.focus();
                    const range = document.createRange();
                    range.selectNodeContents(nameSpan);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }, 10);
                
                let isEditing = true;
                const finishEdit = (ev) => {
                    if (!isEditing) return;
                    if (ev.type === 'keydown' && ev.key !== 'Enter') return;
                    if (ev.key === 'Enter') ev.preventDefault();
                    
                    isEditing = false;
                    nameSpan.contentEditable = 'false';
                    const newGroupName = nameSpan.innerText.trim() || groupName;
                    
                    if (newGroupName !== groupName) {
                        // Update all projects in this group to the new name
                        Object.values(state.projects).forEach(p => {
                            if (p.group === groupName) p.group = newGroupName;
                        });
                        saveSilent();
                        renderSidebar();
                    } else {
                        nameSpan.innerText = groupName;
                    }
                };
                
                nameSpan.addEventListener('blur', finishEdit, { once: true });
                nameSpan.addEventListener('keydown', finishEdit);
            });

            groupTitle.addEventListener('dragover', e => { e.preventDefault(); groupTitle.classList.add('drag-over'); });
            groupTitle.addEventListener('dragleave', () => groupTitle.classList.remove('drag-over'));
            groupTitle.addEventListener('drop', e => {
                e.preventDefault();
                groupTitle.classList.remove('drag-over');
                if (state.draggedProjectId && state.projects[state.draggedProjectId]) {
                    state.projects[state.draggedProjectId].group = groupName;
                    const maxOrder = groups[groupName].length > 0 ? Math.max(...groups[groupName].map(p => p.order)) : 0;
                    state.projects[state.draggedProjectId].order = maxOrder + 1;
                    saveSilent();
                    renderSidebar();
                }
            });

            groupWrap.appendChild(groupTitle);

            const groupContent = document.createElement('div');
            groupContent.className = 'pb-group-content';
            
            // Clear sidebar selection when clicking empty area of group content
            groupContent.addEventListener('click', (e) => {
                // Only clear if clicking directly on the groupContent (empty area)
                if (e.target === groupContent) {
                    state.selectedSidebarItem = null;
                    updateSidebarSelection();
                }
            });
            if (isCollapsed) groupContent.classList.add('collapsed');
            
            // Make sidebar focusable for keyboard events
            groupContent.tabIndex = 0;

            groups[groupName].forEach(proj => {
                const item = document.createElement('div');
                item.className = 'pb-canvas-item' + (proj.id === state.currentProjectId ? ' active' : '');
                item.dataset.projId = proj.id;
                
                // Add drag handle for edit mode (3 dots)
                const dragHandle = document.createElement('div');
                dragHandle.className = 'pb-drag-handle';
                dragHandle.innerHTML = '<span></span><span></span><span></span>';
                dragHandle.title = 'Drag to reorder';
                item.appendChild(dragHandle);
                
                // Add name span with proper class
                const nameSpan = document.createElement('span');
                nameSpan.className = 'pb-name-span';
                nameSpan.innerText = proj.name;
                item.appendChild(nameSpan);
                
                // Add delete button for edit mode
                if (Object.keys(state.projects).length > 1) {
                    const delBtn = document.createElement('span');
                    delBtn.className = 'pb-delete-btn';
                    delBtn.innerHTML = '&times;';
                    delBtn.title = 'Delete Canvas';
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        showConfirm(`Are you sure you want to permanently delete the canvas "${proj.name}"?`, () => {
                            delete state.projects[proj.id];
                            if (state.currentProjectId === proj.id) {
                                state.currentProjectId = Object.keys(state.projects)[0];
                                state.data = state.projects[state.currentProjectId].data;
                                state.canvasTransform = { x: 0, y: 0, scale: 1 };
                                updateTransform();
                                renderAll();
                            }
                            saveSilent();
                            renderSidebar();
                        });
                    };
                    item.appendChild(delBtn);
                }
                
                item.draggable = true;
                
                item.addEventListener('dragstart', () => {
                    state.draggedProjectId = proj.id;
                    setTimeout(() => item.style.opacity = '0.4', 0);
                });
                
                item.addEventListener('dragend', () => {
                    item.style.opacity = '1';
                    state.draggedProjectId = null;
                });
                
                item.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (state.draggedProjectId !== proj.id) item.classList.add('drag-over');
                });
                
                item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
                
                item.addEventListener('drop', (e) => {
                    e.preventDefault();
                    item.classList.remove('drag-over');
                    if (!state.draggedProjectId || state.draggedProjectId === proj.id) return;

                    const draggedProj = state.projects[state.draggedProjectId];
                    const targetProj = state.projects[proj.id];

                    draggedProj.group = targetProj.group;
                    
                    const groupProjs = groups[targetProj.group].filter(p => p.id !== state.draggedProjectId);
                    const targetIndex = groupProjs.findIndex(p => p.id === targetProj.id);
                    groupProjs.splice(targetIndex, 0, draggedProj);
                    
                    groupProjs.forEach((p, idx) => p.order = idx);
                    
                    saveSilent();
                    renderSidebar();
                });

                item.onclick = (e) => {
                    // Ignore clicks on drag handle and delete button
                    if (e.target.closest('.pb-drag-handle') || e.target.closest('.pb-delete-btn')) return;
                    
                    // Check if double-click for rename
                    const now = Date.now();
                    if (item.dataset.lastClick && (now - parseInt(item.dataset.lastClick)) < 400) {
                        item.dataset.lastClick = '0';
                        renameCanvas(proj.id);
                        return;
                    }
                    item.dataset.lastClick = now.toString();
                    
                    // Select this item for keyboard operations
                    state.selectedSidebarItem = proj.id;
                    updateSidebarSelection();
                    
                    if (state.currentProjectId !== proj.id) {
                        switchCanvas(proj.id);
                    }
                    // Single click on current canvas: just select, don't enter edit mode
                    // Edit mode is only entered when user clicks on the name span directly
                };
                
                // Enter edit mode only when clicking directly on the name span (not the whole item)
                nameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (nameSpan.contentEditable === 'true') return;
                    
                    state.selectedSidebarItem = proj.id;
                    updateSidebarSelection();
                    
                    nameSpan.contentEditable = 'true';
                    nameSpan.style.outline = 'none';
                    nameSpan.style.borderBottom = '1px solid var(--ichtus-orange)';
                    nameSpan.focus();
                    
                    const range = document.createRange();
                    range.selectNodeContents(nameSpan);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    
                    let isEditing = true;
                    const finishEdit = (ev) => {
                        if (!isEditing) return;
                        if (ev.type === 'keydown' && ev.key !== 'Enter') return;
                        if (ev.key === 'Enter') ev.preventDefault();
                        
                        isEditing = false;
                        nameSpan.contentEditable = 'false';
                        state.projects[proj.id].name = nameSpan.innerText.trim() || 'Unnamed Canvas';
                        saveSilent();
                        renderSidebar();
                    };
                    
                    nameSpan.addEventListener('blur', finishEdit, { once: true });
                    nameSpan.addEventListener('keydown', finishEdit);
                });
                groupContent.appendChild(item);
            });
            
            groupWrap.appendChild(groupContent);
            content.appendChild(groupWrap);
        });
    }

    // ==================== NODE CONFIGURATION ====================

    function openNodeConfig(nodeId) {
        const node = state.data.nodes.find(n => n.id == nodeId);
        if (!node) return;

        let modal = document.getElementById('node-config-modal');
        let backdrop = document.getElementById('node-config-backdrop');
        
        if (!modal) {
            backdrop = document.createElement('div');
            backdrop.id = 'node-config-backdrop';
            backdrop.className = 'config-backdrop';
            document.body.appendChild(backdrop);

            modal = document.createElement('div');
            modal.id = 'node-config-modal';
            modal.className = 'config-modal';
            document.body.appendChild(modal);
        }

        backdrop.style.display = 'block';
        modal.style.display = 'flex';

        modal.innerHTML = `
            <h3>Edit Block</h3>
            <label>Title:</label>
            <input type=\"text\" id=\"cfg-title\" value=\"${node.title}\">
            <label>IP / Subtext:</label>
            <input type=\"text\" id=\"cfg-ip\" value=\"${node.ip}\">
            
            <label>Inputs:</label>
            <div id=\"cfg-inputs-container\" class=\"ports-container\"></div>
            <button id=\"cfg-add-input\" class=\"btn-add-port\">+ Add Input</button>
            
            <label>Outputs:</label>
            <div id=\"cfg-outputs-container\" class=\"ports-container\"></div>
            <button id=\"cfg-add-output\" class=\"btn-add-port\">+ Add Output</button>

            <div class=\"config-actions\">
                <button id=\"cfg-delete\" class=\"btn-delete\">Delete</button>
                <div>
                    <button id=\"cfg-cancel\" class=\"btn-cancel\">Cancel</button>
                    <button id=\"cfg-save\" class=\"btn-save\">Save</button>
                </div>
            </div>
        `;

        function renderPorts(containerId, ports) {
            const c = document.getElementById(containerId);
            c.innerHTML = '';
            ports.forEach(port => {
                const row = document.createElement('div');
                row.className = 'port-edit-row';
                row.innerHTML = `
                    <input type=\"text\" value=\"${port}\" class=\"port-input-field\">
                    <button class=\"btn-remove-port\" title=\"Remove Port\">&times;</button>
                `;
                row.querySelector('.btn-remove-port').onclick = () => row.remove();
                c.appendChild(row);
            });
        }

        renderPorts('cfg-inputs-container', node.inputs);
        renderPorts('cfg-outputs-container', node.outputs);

        document.getElementById('cfg-add-input').onclick = () => {
            const c = document.getElementById('cfg-inputs-container');
            const row = document.createElement('div');
            row.className = 'port-edit-row';
            row.innerHTML = `<input type=\"text\" value=\"New Input\" class=\"port-input-field\"><button class=\"btn-remove-port\" title=\"Remove Port\">&times;</button>`;
            row.querySelector('.btn-remove-port').onclick = () => row.remove();
            c.appendChild(row);
            
            const input = row.querySelector('input');
            input.focus();
            input.select();
        };

        document.getElementById('cfg-add-output').onclick = () => {
            const c = document.getElementById('cfg-outputs-container');
            const row = document.createElement('div');
            row.className = 'port-edit-row';
            row.innerHTML = `<input type=\"text\" value=\"New Output\" class=\"port-input-field\"><button class=\"btn-remove-port\" title=\"Remove Port\">&times;</button>`;
            row.querySelector('.btn-remove-port').onclick = () => row.remove();
            c.appendChild(row);
            
            const input = row.querySelector('input');
            input.focus();
            input.select();
        };

        document.getElementById('cfg-cancel').onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };
        document.getElementById('cfg-delete').onclick = () => {
            showConfirm('Are you sure you want to delete this node (and all connected cables)?', () => {
                state.data.nodes = state.data.nodes.filter(n => n.id != nodeId);
                state.data.connections = state.data.connections.filter(c => c.from != nodeId && c.to != nodeId);
                modal.style.display = 'none'; backdrop.style.display = 'none'; renderAll();
            });
        };
        document.getElementById('cfg-save').onclick = () => {
            node.title = document.getElementById('cfg-title').value;
            node.ip = document.getElementById('cfg-ip').value;
            node.inputs = Array.from(document.querySelectorAll('#cfg-inputs-container .port-input-field')).map(input => input.value.trim()).filter(val => val);
            node.outputs = Array.from(document.querySelectorAll('#cfg-outputs-container .port-input-field')).map(input => input.value.trim()).filter(val => val);
            modal.style.display = 'none'; backdrop.style.display = 'none'; renderNodes(); requestAnimationFrame(renderConnections);
        };
    }

    // ==================== CONNECTION CONFIGURATION ====================

    function openConnConfig(idx) {
        const conn = state.data.connections[idx];
        if (!conn) return;

        let defaultCable = conn.cable;
        if (!defaultCable) {
            if(conn.type === 'video') defaultCable = 'SDI';
            else if(conn.type === 'audio') defaultCable = 'XLR';
            else if(conn.type === 'network') defaultCable = 'Ethernet';
            else if(conn.type === 'lighting') defaultCable = 'DMX';
            else defaultCable = 'Custom';
        }

        let modal = document.getElementById('conn-config-modal');
        let backdrop = document.getElementById('node-config-backdrop');
        
        if (!modal) {
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'node-config-backdrop';
                backdrop.className = 'config-backdrop';
                document.body.appendChild(backdrop);
            }
            modal = document.createElement('div');
            modal.id = 'conn-config-modal';
            modal.className = 'config-modal';
            document.body.appendChild(modal);
        }

        backdrop.style.display = 'block';
        modal.style.display = 'flex';

        const cables = [
            { group: 'Video', options: ['HDMI', 'DisplayPort', 'SDI'] },
            { group: 'Audio', options: ['XLR', 'Jack 6.3mm', 'Jack 3.5mm', 'Speakon'] },
            { group: 'Network', options: ['Ethernet', 'NDI', 'Dante'] },
            { group: 'Data & Power', options: ['USB-C', 'USB-A', 'PowerCON', 'IEC', 'Schuko'] },
            { group: 'Lighting', options: ['DMX'] },
            { group: 'Other', options: ['Custom'] }
        ];

        let isCustom = !cables.some(g => g.options.includes(defaultCable));
        
        let optionsHtml = '';
        cables.forEach(g => {
            optionsHtml += `<optgroup label=\"${g.group}\">`;
            g.options.forEach(opt => {
                const selected = (!isCustom && defaultCable === opt) || (isCustom && opt === 'Custom') ? 'selected' : '';
                optionsHtml += `<option value=\"${opt}\" ${selected}>${opt}</option>`;
            });
            optionsHtml += `</optgroup>`;
        });

        modal.innerHTML = `
            <h3>Edit Cable Connection</h3>
            <label>Cable Standard:</label>
            <select id=\"cfg-conn-cable\" class=\"config-select\">
                ${optionsHtml}
            </select>
            <input type=\"text\" id=\"cfg-conn-custom\" value=\"${isCustom ? defaultCable : ''}\" placeholder=\"Enter custom cable...\" style=\"display: ${isCustom ? 'block' : 'none'}; margin-top: 8px;\">
            <div class=\"config-actions\">
                <div></div>
                <div>
                    <button id=\"cfg-conn-cancel\" class=\"btn-cancel\">Cancel</button>
                    <button id=\"cfg-conn-save\" class=\"btn-save\">Save</button>
                </div>
            </div>
        `;

        document.getElementById('cfg-conn-cable').addEventListener('change', (e) => {
            document.getElementById('cfg-conn-custom').style.display = e.target.value === 'Custom' ? 'block' : 'none';
        });

        document.getElementById('cfg-conn-cancel').onclick = () => { modal.style.display = 'none'; backdrop.style.display = 'none'; };
        document.getElementById('cfg-conn-save').onclick = () => {
            const selectedCable = document.getElementById('cfg-conn-cable').value;
            conn.cable = selectedCable === 'Custom' ? document.getElementById('cfg-conn-custom').value : selectedCable;
            modal.style.display = 'none'; backdrop.style.display = 'none';
            renderConnections();
        };
    }

    // ==================== CONTEXT MENU ====================

    function showContextMenu(x, y, type, targetId, folderTarget) {
        // Remove existing context menu
        hideContextMenu();
        
        const menu = document.createElement('div');
        menu.className = 'pb-context-menu';
        menu.id = 'pb-context-menu';
        
        const currentProject = state.projects[state.currentProjectId];
        const hasContent = currentProject && currentProject.data.nodes.length > 0;
        const hasClipboard = state.clipboardData !== null;
        
        // Determine which options to show based on context type
        const isCanvas = type === 'canvas';
        const isSidebar = type === 'sidebar-item' || type === 'folder' || type === 'sidebar';
        const isNode = type === 'node';
        
        // Build menu items
        let items = [];
        
        // ============= CANVAS CONTEXT =============
        if (isCanvas) {
            items.push({ label: 'Add Node Here', action: () => addNodeAtPosition(x, y), icon: '➕' });
            items.push({ type: 'separator' });
            
            // Paste on canvas - paste nodes onto the current canvas
            if (hasClipboard) {
                items.push({ label: 'Paste', action: () => pasteOnCanvas(), icon: '📋' });
            }
            
            if (hasContent) {
                items.push({ label: 'Copy Canvas', action: () => copyCanvasToSidebar(), icon: '📋' });
                items.push({ type: 'separator' });
                items.push({ label: 'Export Canvas', action: () => exportCanvas(), icon: '💾' });
            }
        }
        
        // ============= NODE CONTEXT =============
        if (isNode && targetId) {
            items.push({ label: 'Edit Node', action: () => openNodeConfig(targetId), icon: '⚙️' });
            items.push({ type: 'separator' });
            items.push({ label: 'Delete Node', action: () => deleteNode(targetId), icon: '🗑️', danger: true });
        }
        
        // ============= SIDEBAR CONTEXT =============
        if (isSidebar) {
            // Copy option for sidebar items
            if (targetId && state.projects[targetId]) {
                items.push({ label: 'Copy', action: () => copyProjectToClipboard(targetId), icon: '📋' });
                items.push({ label: 'Export', action: () => exportSingleProject(targetId), icon: '💾' });
                items.push({ type: 'separator' });
                items.push({ label: 'Duplicate', action: () => duplicateCanvas(targetId), icon: '📑' });
                items.push({ label: 'Rename', action: () => renameCanvas(targetId), icon: '✏️' });
                items.push({ type: 'separator' });
                items.push({ label: 'Delete', action: () => deleteCanvas(targetId), icon: '🗑️', danger: true });
            } else {
                // Empty sidebar or folder - show paste option to create new canvas
                if (hasClipboard) {
                    const targetFolder = folderTarget || 'General';
                    items.push({ label: 'Paste', action: () => pasteCanvasFromClipboard(targetFolder), icon: '📋' });
                    items.push({ type: 'separator' });
                }
                items.push({ label: 'New Canvas', action: () => createNewCanvas(folderTarget), icon: '➕' });
                items.push({ label: 'New Folder', action: () => createNewFolder(), icon: '📁' });
                items.push({ type: 'separator' });
                items.push({ label: 'Import...', action: () => handleImportCanvases(), icon: '📥' });
                items.push({ label: 'Export All...', action: () => exportAllProjects(), icon: '💾' });
            }
        }
        
        // Build HTML and attach click handlers
        let html = '';
        let menuItemIndex = 0; // Track menu item index separately from items array
        items.forEach((item) => {
            if (item.type === 'separator') {
                html += '<div class="pb-context-separator"></div>';
            } else {
                const disabledClass = item.disabled ? ' disabled' : '';
                const dangerClass = item.danger ? ' danger' : '';
                html += `<div class="pb-context-menu-item${disabledClass}${dangerClass}" data-menu-index="${menuItemIndex}">${item.icon} ${item.label}</div>`;
                menuItemIndex++;
            }
        });
        
        menu.innerHTML = html;
        
        // Position menu
        document.body.appendChild(menu);
        
        // Adjust position if menu would go off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            x = window.innerWidth - rect.width - 10;
        }
        if (rect.bottom > window.innerHeight) {
            y = window.innerHeight - rect.height - 10;
        }
        
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'flex';
        
        // Add click handlers - use data-menu-index attribute to find correct action
        // Build a mapping from menu item index to items array index
        const menuItemToItemsMap = [];
        let mi = 0;
        items.forEach((item, idx) => {
            if (item.type === 'separator') {
                // Skip
            } else {
                menuItemToItemsMap[mi] = idx;
                mi++;
            }
        });
        
        menu.querySelectorAll('.pb-context-menu-item').forEach((itemEl) => {
            const menuIdx = parseInt(itemEl.dataset.menuIndex, 10);
            const itemIdx = menuItemToItemsMap[menuIdx];
            if (itemIdx !== undefined && items[itemIdx] && items[itemIdx].action) {
                const action = items[itemIdx].action;
                itemEl.addEventListener('click', () => {
                    action();
                    hideContextMenu();
                });
            }
        });
        
        // Store context info
        menu.dataset.contextType = type;
        menu.dataset.targetId = targetId || '';
        menu.dataset.folderTarget = folderTarget || '';
    }
    
    function hideContextMenu() {
        const menu = document.getElementById('pb-context-menu');
        if (menu) menu.remove();
    }
    
    function addNodeAtPosition(x, y) {
        const scaledX = (x - state.canvasTransform.x) / state.canvasTransform.scale;
        const scaledY = (y - state.canvasTransform.y) / state.canvasTransform.scale;
        
        const newNode = {
            id: 'node_' + Date.now(),
            title: 'New Device',
            ip: '0.0.0.0',
            x: scaledX - 80,
            y: scaledY - 50,
            inputs: ['Input 1'],
            outputs: ['Output 1']
        };
        
        state.data.nodes.push(newNode);
        renderAll();
        saveSilent();
        
        setTimeout(() => openNodeConfig(newNode.id), 50);
    }
    
    // Copy project to sidebar clipboard (stores project reference, not just data)
    function copyProjectToClipboard(projectId) {
        const proj = state.projects[projectId];
        if (!proj) return;
        
        state.clipboardData = {
            type: 'project',
            projectId: projectId,
            name: proj.name,
            data: JSON.parse(JSON.stringify(proj.data))
        };
        showStatus(`Copied "${proj.name}" to clipboard`, 'info');
    }
    
    // Copy current canvas to clipboard (same as copyProjectToClipboard for current project)
    function copyCanvasToSidebar() {
        copyProjectToClipboard(state.currentProjectId);
    }
    
    // Paste project from clipboard onto the current canvas (adds nodes)
    function pasteOnCanvas() {
        if (!state.clipboardData || state.clipboardData.type !== 'project' || !state.clipboardData.data) {
            showStatus('Nothing to paste', 'info');
            return;
        }
        
        const clipboardNodes = state.clipboardData.data.nodes;
        if (!clipboardNodes || clipboardNodes.length === 0) {
            showStatus('Nothing to paste', 'info');
            return;
        }
        
        // Add nodes to current canvas, offset from center
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        const centerX = (rect.width / 2 - state.canvasTransform.x) / state.canvasTransform.scale;
        const centerY = (rect.height / 2 - state.canvasTransform.y) / state.canvasTransform.scale;
        
        // Calculate offset from original position
        const originalNode = clipboardNodes[0];
        const offsetX = centerX - (originalNode.x || 0);
        const offsetY = centerY - (originalNode.y || 0);
        
        const idMap = {};
        
        // Add nodes
        clipboardNodes.forEach(node => {
            const newId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            idMap[node.id] = newId;
            
            const newNode = JSON.parse(JSON.stringify(node));
            newNode.id = newId;
            newNode.x += offsetX;
            newNode.y += offsetY;
            state.data.nodes.push(newNode);
        });
        
        // Add connections
        const clipboardConns = state.clipboardData.data.connections;
        if (clipboardConns && clipboardConns.length > 0) {
            clipboardConns.forEach(conn => {
                if (idMap[conn.from] && idMap[conn.to]) {
                    state.data.connections.push({
                        from: idMap[conn.from],
                        fromPort: conn.fromPort,
                        to: idMap[conn.to],
                        toPort: conn.toPort,
                        type: conn.type,
                        cable: conn.cable
                    });
                }
            });
        }
        
        renderAll();
        saveSilent();
        showStatus(`Pasted "${state.clipboardData.name}" (${clipboardNodes.length} nodes)`, 'info');
    }
    
    // Paste canvas from clipboard as a new project in the sidebar
    function pasteCanvasFromClipboard(targetFolder) {
        if (!state.clipboardData || state.clipboardData.type !== 'project') {
            showStatus('Nothing to paste', 'info');
            return;
        }
        
        const newId = 'proj_' + Date.now();
        const pasteName = state.clipboardData.name ? `${state.clipboardData.name} (pasted)` : 'Pasted Canvas';
        
        // Deep clone the data and regenerate IDs
        const copyData = JSON.parse(JSON.stringify(state.clipboardData.data));
        
        // Generate new IDs for all nodes and update connections
        const idMap = {};
        copyData.nodes.forEach(node => {
            const newNodeId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            idMap[node.id] = newNodeId;
            node.id = newNodeId;
        });
        
        copyData.connections.forEach(conn => {
            conn.from = idMap[conn.from] || conn.from;
            conn.to = idMap[conn.to] || conn.to;
        });
        
        // Create the new project in the target folder
        state.projects[newId] = {
            id: newId,
            name: pasteName,
            group: targetFolder || 'General',
            order: Date.now(),
            data: copyData
        };
        
        saveSilent();
        renderSidebar();
        showStatus(`Created "${pasteName}"`, 'info');
    }
    
    function duplicateCanvas(sourceId) {
        const sourceProj = state.projects[sourceId];
        if (!sourceProj) return;
        
        const newId = 'proj_' + Date.now();
        const copyName = sourceProj.name ? `${sourceProj.name} (copy)` : 'New Canvas';
        
        // Deep clone the data
        const copyData = JSON.parse(JSON.stringify(sourceProj.data));
        
        // Generate new IDs for all nodes and update connections
        const idMap = {};
        copyData.nodes.forEach(node => {
            const newNodeId = 'node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            idMap[node.id] = newNodeId;
            node.id = newNodeId;
        });
        
        // Update connection references
        copyData.connections.forEach(conn => {
            conn.from = idMap[conn.from] || conn.from;
            conn.to = idMap[conn.to] || conn.to;
        });
        
        // Create the new project
        state.projects[newId] = {
            id: newId,
            name: copyName,
            group: sourceProj.group,
            order: Date.now(),
            data: copyData
        };
        
        saveSilent();
        renderSidebar();
        showStatus(`Duplicated as "${copyName}"`, 'info');
    }
    
    // Custom prompt dialog (replaces browser prompt)
    function showPrompt(message, defaultValue, onConfirm, onCancel) {
        // Remove existing prompt modal if any
        const existingModal = document.getElementById('pb-prompt-modal');
        if (existingModal) existingModal.remove();
        const existingBackdrop = document.getElementById('pb-prompt-backdrop');
        if (existingBackdrop) existingBackdrop.remove();
        
        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'pb-prompt-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10002;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'pb-prompt-modal';
        modal.style.cssText = `
            position: fixed;
            background: #1e1e1e;
            border: 2px solid var(--ichtus-orange, #f47920);
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            min-width: 300px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            z-index: 10003;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        `;
        
        // Message
        const msgEl = document.createElement('p');
        msgEl.style.cssText = `
            color: #ffffff;
            font-size: 16px;
            line-height: 1.5;
            margin: 0 0 16px 0;
            font-family: inherit;
        `;
        msgEl.textContent = message;
        modal.appendChild(msgEl);
        
        // Input field
        const input = document.createElement('input');
        input.type = 'text';
        input.value = defaultValue || '';
        input.style.cssText = `
            width: 100%;
            padding: 12px 16px;
            background: #2d2d2d;
            border: 2px solid #4d4d4f;
            border-radius: 6px;
            color: #ffffff;
            font-size: 16px;
            font-family: inherit;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.2s ease;
        `;
        input.onfocus = () => { input.style.borderColor = 'var(--ichtus-orange, #f47920)'; };
        input.onblur = () => { input.style.borderColor = '#4d4d4f'; };
        modal.appendChild(input);
        
        // Buttons
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 20px;
        `;
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            background: transparent;
            border: 2px solid #666;
            color: #aaa;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
            transition: all 0.2s ease;
        `;
        cancelBtn.onmouseenter = () => { cancelBtn.style.borderColor = '#888'; cancelBtn.style.color = '#fff'; };
        cancelBtn.onmouseleave = () => { cancelBtn.style.borderColor = '#666'; cancelBtn.style.color = '#aaa'; };
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'OK';
        confirmBtn.style.cssText = `
            background: var(--ichtus-orange, #f47920);
            border: 2px solid var(--ichtus-orange, #f47920);
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
            font-weight: bold;
            transition: all 0.2s ease;
        `;
        confirmBtn.onmouseenter = () => { confirmBtn.style.background = '#d86d1a'; confirmBtn.style.transform = 'scale(1.02)'; };
        confirmBtn.onmouseleave = () => { confirmBtn.style.background = 'var(--ichtus-orange, #f47920)'; confirmBtn.style.transform = 'scale(1)'; };
        
        // Click handlers
        const closeModal = () => {
            backdrop.remove();
            modal.remove();
        };
        
        cancelBtn.onclick = () => {
            closeModal();
            if (onCancel) onCancel();
        };
        
        confirmBtn.onclick = () => {
            const value = input.value;
            closeModal();
            if (onConfirm) onConfirm(value);
        };
        
        // Also close on backdrop click
        backdrop.onclick = (e) => {
            if (e.target === backdrop) {
                closeModal();
                if (onCancel) onCancel();
            }
        };
        
        // Handle Enter and Escape keys
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                if (onCancel) onCancel();
                input.removeEventListener('keydown', keyHandler);
            } else if (e.key === 'Enter') {
                const value = input.value;
                closeModal();
                if (onConfirm) onConfirm(value);
                input.removeEventListener('keydown', keyHandler);
            }
        };
        input.addEventListener('keydown', keyHandler);
        
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        modal.appendChild(btnContainer);
        
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        
        // Focus the input and select the text
        input.focus();
        input.select();
    }
    
    function renameCanvas(projectId) {
        const proj = state.projects[projectId];
        if (!proj) return;
        
        showPrompt('Rename canvas:', proj.name, (newName) => {
            if (newName && newName.trim()) {
                proj.name = newName.trim();
                saveSilent();
                renderSidebar();
                showStatus(`Renamed to "${proj.name}"`, 'info');
            }
        }, () => {
            // Cancelled - do nothing
        });
    }
    
    function renameFolder(folderName) {
        if (!folderName || folderName === 'General') return; // Can't rename General folder
        
        showPrompt('Rename folder:', folderName, (newName) => {
            if (newName && newName.trim() && newName.trim() !== folderName) {
                const newFolderName = newName.trim();
                // Update all projects in this folder
                Object.values(state.projects).forEach(p => {
                    if (p.group === folderName) p.group = newFolderName;
                });
                saveSilent();
                
                // Update selection if this folder was selected
                if (state.selectedSidebarItem === 'folder:' + folderName) {
                    state.selectedSidebarItem = 'folder:' + newFolderName;
                }
                
                renderSidebar();
                showStatus(`Renamed folder to "${newFolderName}"`, 'info');
            }
        }, () => {
            // Cancelled - do nothing
        });
    }
    
    function deleteFolder(folderName) {
        if (!folderName || folderName === 'General') {
            showStatus('Cannot delete the General folder', 'info');
            return;
        }
        
        // Check if folder has canvases
        const canvasesInFolder = Object.values(state.projects).filter(p => p.group === folderName);
        
        showConfirm(`Delete folder "${folderName}"? ${canvasesInFolder.length > 0 ? `(${canvasesInFolder.length} canvas(es) will be moved to General)` : ''}`, () => {
            // Move canvases to General
            Object.values(state.projects).forEach(p => {
                if (p.group === folderName) p.group = 'General';
            });
            saveSilent();
            
            // Clear selection if this folder was selected
            if (state.selectedSidebarItem === 'folder:' + folderName) {
                state.selectedSidebarItem = null;
            }
            
            renderSidebar();
            showStatus(`Deleted folder "${folderName}"`, 'info');
        });
    }
    
    function createNewCanvas(folderTarget) {
        const id = 'proj_' + Date.now();
        state.projects[id] = { 
            id, 
            name: 'New Canvas', 
            group: folderTarget || 'General', 
            data: { nodes: [], connections: [] } 
        };
        saveSilent();
        switchCanvas(id);
        renderSidebar();
    }
    
    function createNewFolder() {
        // Trigger the same flow as the add folder button
        const content = document.getElementById('pb-sidebar-content');
        
        const groupTitle = document.createElement('div');
        groupTitle.className = 'pb-group-title';
        
        const newSpan = document.createElement('span');
        newSpan.innerText = 'New Folder';
        newSpan.contentEditable = 'true';
        newSpan.style.outline = 'none';
        newSpan.style.borderBottom = '1px solid var(--ichtus-orange)';
        newSpan.style.flex = '1';
        
        groupTitle.appendChild(newSpan);
        
        const groupWrap = document.createElement('div');
        groupWrap.className = 'pb-group-wrap';
        groupWrap.appendChild(groupTitle);
        content.insertBefore(groupWrap, content.firstChild);
        
        newSpan.focus();
        
        const range = document.createRange();
        range.selectNodeContents(newSpan);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        
        let isEditing = true;
        const finishEdit = (e) => {
            if (!isEditing) return;
            if (e.type === 'keydown' && e.key !== 'Enter') return;
            if (e.key === 'Enter') e.preventDefault();
            
            isEditing = false;
            newSpan.contentEditable = 'false';
            const finalGroupName = newSpan.innerText.trim();
            
            if (finalGroupName) {
                // Update all projects in "New Folder" to the new name
                Object.values(state.projects).forEach(p => {
                    if (!p.group || p.group === 'New Folder') p.group = finalGroupName;
                });
                saveSilent();
            }
            renderSidebar();
        };
        
        newSpan.addEventListener('blur', finishEdit);
        newSpan.addEventListener('keydown', finishEdit);
    }
    
    function deleteNode(nodeId) {
        showConfirm('Are you sure you want to delete this node (and all connected cables)?', () => {
            state.data.nodes = state.data.nodes.filter(n => n.id != nodeId);
            state.data.connections = state.data.connections.filter(c => c.from != nodeId && c.to != nodeId);
            renderAll();
            saveSilent();
        });
    }
    
    function deleteCanvas(canvasId) {
        const proj = state.projects[canvasId];
        if (!proj) return;
        
        showConfirm(`Are you sure you want to permanently delete the canvas "${proj.name}"?`, () => {
            delete state.projects[canvasId];
            if (state.currentProjectId === canvasId) {
                state.currentProjectId = Object.keys(state.projects)[0];
                state.data = state.projects[state.currentProjectId].data;
                state.canvasTransform = { x: 0, y: 0, scale: 1 };
                updateTransform();
                renderAll();
            }
            saveSilent();
            renderSidebar();
        });
    }
    
    function exportCanvas() {
        // Export in folder format to be compatible with import
        const currentProj = state.projects[state.currentProjectId];
        
        const exportData = {
            ichtusVersion: 1,
            type: 'folder',
            name: currentProj.name || 'Exported Canvas',
            canvases: [{
                id: currentProj.id,
                name: currentProj.name || 'Main Patchbay',
                group: currentProj.group || 'General',
                data: state.data
            }]
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentProj.name || 'patchbay-canvas'}.ichtus-folder.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        showStatus('Canvas exported', 'info');
    }

    function exportAllProjects() {
        const allCanvases = Object.values(state.projects).map(proj => ({
            id: proj.id,
            name: proj.name,
            group: proj.group,
            data: proj.data
        }));
        
        const exportData = {
            ichtusVersion: 1,
            type: 'folder',
            name: 'All Canvases Export',
            canvases: allCanvases
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = 'All-Canvases-' + dateStr + '.ichtus-folder.json';
        a.click();
        
        URL.revokeObjectURL(url);
        showStatus('All canvases exported', 'info');
    }

    function exportSingleProject(projectId) {
        const proj = state.projects[projectId];
        if (!proj) return;
        
        const exportData = {
            ichtusVersion: 1,
            type: 'folder',
            name: proj.name || 'Exported Canvas',
            canvases: [{
                id: proj.id,
                name: proj.name || 'Main Patchbay',
                group: proj.group || 'General',
                data: proj.data
            }]
        };
        
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = (proj.name || 'canvas') + '.ichtus-folder.json';
        a.click();
        
        URL.revokeObjectURL(url);
        showStatus('Canvas exported', 'info');
    }


    function showStatus(msg, type) {
        // Create a temporary toast notification
        const toast = document.createElement('div');
        toast.className = 'pb-toast';
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(42, 42, 42, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10001;
            border: 1px solid var(--ichtus-orange, #f47920);
            animation: toast-fade 2s ease-in-out forwards;
        `;
        toast.textContent = msg;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 2000);
    }
    
    // Custom confirmation dialog (replaces browser confirm)
    function showConfirm(message, onConfirm, onCancel) {
        // Remove existing confirm modal if any
        const existingModal = document.getElementById('pb-confirm-modal');
        if (existingModal) existingModal.remove();
        const existingBackdrop = document.getElementById('pb-confirm-backdrop');
        if (existingBackdrop) existingBackdrop.remove();
        
        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'pb-confirm-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10002;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        // Create modal
        const modal = document.createElement('div');
        modal.id = 'pb-confirm-modal';
        modal.style.cssText = `
            position: fixed;
            background: #1e1e1e;
            border: 2px solid var(--ichtus-orange, #f47920);
            border-radius: 12px;
            padding: 24px;
            max-width: 400px;
            min-width: 300px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            z-index: 10003;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        `;
        
        // Message
        const msgEl = document.createElement('p');
        msgEl.style.cssText = `
            color: #ffffff;
            font-size: 16px;
            line-height: 1.5;
            margin: 0 0 24px 0;
            font-family: inherit;
        `;
        msgEl.textContent = message;
        modal.appendChild(msgEl);
        
        // Buttons
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = `
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        `;
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = `
            background: transparent;
            border: 2px solid #666;
            color: #aaa;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
            transition: all 0.2s ease;
        `;
        cancelBtn.onmouseenter = () => {
            cancelBtn.style.borderColor = '#888';
            cancelBtn.style.color = '#fff';
        };
        cancelBtn.onmouseleave = () => {
            cancelBtn.style.borderColor = '#666';
            cancelBtn.style.color = '#aaa';
        };
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Delete';
        confirmBtn.style.cssText = `
            background: var(--ichtus-orange, #f47920);
            border: 2px solid var(--ichtus-orange, #f47920);
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
            font-weight: bold;
            transition: all 0.2s ease;
        `;
        confirmBtn.onmouseenter = () => {
            confirmBtn.style.background = '#d86d1a';
            confirmBtn.style.transform = 'scale(1.02)';
        };
        confirmBtn.onmouseleave = () => {
            confirmBtn.style.background = 'var(--ichtus-orange, #f47920)';
            confirmBtn.style.transform = 'scale(1)';
        };
        
        // Click handlers
        const closeModal = () => {
            backdrop.remove();
            modal.remove();
        };
        
        cancelBtn.onclick = () => {
            closeModal();
            if (onCancel) onCancel();
        };
        
        confirmBtn.onclick = () => {
            closeModal();
            if (onConfirm) onConfirm();
        };
        
        // Also close on backdrop click
        backdrop.onclick = () => {
            closeModal();
            if (onCancel) onCancel();
        };
        
        // Close on Escape key
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                if (onCancel) onCancel();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(confirmBtn);
        modal.appendChild(btnContainer);
        
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);
        
        // Focus the cancel button (safe choice)
        cancelBtn.focus();
    }
    
    // ==================== SELECTION HELPERS ====================
    
    function clearSelection() {
        state.selectedNodes = [];
        // Remove selected and selection-preview class from all nodes
        document.querySelectorAll('.node.selected, .node.selection-preview').forEach(n => {
            n.classList.remove('selected');
            n.classList.remove('selection-preview');
        });
    }
    
    function updateSelectionHighlight() {
        if (!state.selectionRect) return;
        
        const rect = state.selectionRect.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        // Convert selection rectangle to canvas coordinates
        const selLeft = (rect.left - containerRect.left - state.canvasTransform.x) / state.canvasTransform.scale;
        const selTop = (rect.top - containerRect.top - state.canvasTransform.y) / state.canvasTransform.scale;
        const selRight = selLeft + rect.width / state.canvasTransform.scale;
        const selBottom = selTop + rect.height / state.canvasTransform.scale;
        
        // Check each node for intersection
        state.data.nodes.forEach(node => {
            const nodeEl = document.getElementById(`node-${node.id}`);
            if (!nodeEl) return;
            
            // Node dimensions (approximate, can be refined)
            const nodeLeft = node.x;
            const nodeTop = node.y;
            const nodeRight = node.x + 160; // Approximate node width
            const nodeBottom = node.y + 100; // Approximate node height
            
            // Check if node intersects with selection rectangle
            const intersects = !(nodeRight < selLeft || nodeLeft > selRight || nodeBottom < selTop || nodeTop > selBottom);
            
            if (intersects) {
                nodeEl.classList.add('selection-preview');
            } else {
                nodeEl.classList.remove('selection-preview');
            }
        });
    }
    
    function selectNodesInRect() {
        if (!state.selectionRect) {
            console.log('selectNodesInRect: no selectionRect');
            return;
        }
        
        const selRect = state.selectionRect.getBoundingClientRect();
        
        // Skip if selection rectangle has no size
        if (selRect.width < 5 || selRect.height < 5) {
            console.log('Selection too small, ignoring');
            return;
        }
        
        console.log('selectNodesInRect: selection rect', selRect.width, 'x', selRect.height, 'at', selRect.left, selRect.top);
        
        // Find nodes that intersect with selection - use page coordinates directly
        const newlySelected = [];
        
        state.data.nodes.forEach(node => {
            const nodeEl = document.getElementById(`node-${node.id}`);
            if (!nodeEl) {
                console.log('Node element not found for', node.id);
                return;
            }
            
            // Remove preview class
            nodeEl.classList.remove('selection-preview');
            
            // Get node's ACTUAL position on page (accounting for CSS transform)
            const nodeRect = nodeEl.getBoundingClientRect();
            console.log('Checking node', node.id, '- nodeRect:', nodeRect.left, nodeRect.top, nodeRect.width, nodeRect.height);
            console.log('  selRect:', selRect.left, selRect.top, selRect.width, selRect.height);
            
            // Check intersection in page coordinates
            const intersects = !(nodeRect.right < selRect.left || nodeRect.left > selRect.right || 
                                 nodeRect.bottom < selRect.top || nodeRect.top > selRect.bottom);
            
            console.log('  intersects:', intersects);
            
            if (intersects && !state.selectedNodes.includes(node.id)) {
                newlySelected.push(node.id);
                nodeEl.classList.add('selected');
                console.log('  -> Selected node', node.id);
            }
        });
        
        // Add newly selected nodes to state
        state.selectedNodes = [...state.selectedNodes, ...newlySelected];
        
        console.log('Total selected:', state.selectedNodes.length, newlySelected.length, 'new');
        
        // Show selection info if any nodes selected
        if (state.selectedNodes.length > 0) {
            showStatus(`${state.selectedNodes.length} node(s) selected - Press Delete to remove`, 'info');
        }
    }
    
    function deleteSelectedNodes() {
        if (state.selectedNodes.length === 0) return;
        
        const count = state.selectedNodes.length;
        showConfirm(`Are you sure you want to delete ${count} selected node(s) and all their connections?`, () => {
            // Remove connections that involve any of the selected nodes
            state.data.connections = state.data.connections.filter(c => 
                !state.selectedNodes.includes(c.from) && !state.selectedNodes.includes(c.to)
            );
            
            // Remove the selected nodes
            state.data.nodes = state.data.nodes.filter(n => !state.selectedNodes.includes(n.id));
            
            // Clear selection
            clearSelection();
            
            // Re-render
            renderAll();
            saveSilent();
            
            showStatus(`Deleted ${count} node(s)`, 'info');
        });
    }
    
    // ==================== EVENT HANDLERS ====================

    function initEventListeners() {
        if (!container) return;

        // Context menu on canvas
        container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            
            const nodeEl = e.target.closest ? e.target.closest('.node') : null;
            
            if (nodeEl) {
                const nodeId = nodeEl.id.replace('node-', '');
                showContextMenu(e.clientX, e.clientY, 'node', nodeId);
            } else {
                showContextMenu(e.clientX, e.clientY, 'canvas', null);
            }
        });
        
        // Context menu on sidebar content
        const sidebarContent = document.getElementById('pb-sidebar-content');
        if (sidebarContent) {
            sidebarContent.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                
                const itemEl = e.target.closest ? e.target.closest('.pb-canvas-item') : null;
                const groupEl = e.target.closest ? e.target.closest('.pb-group-title') : null;
                const groupContent = e.target.closest ? e.target.closest('.pb-group-content') : null;
                
                if (itemEl && itemEl.dataset.projId) {
                    showContextMenu(e.clientX, e.clientY, 'sidebar-item', itemEl.dataset.projId);
                } else if (groupEl) {
                    // Right-clicked on folder header - get folder name
                    const groupName = groupEl.querySelector('span:not(.pb-caret)')?.innerText || 'General';
                    showContextMenu(e.clientX, e.clientY, 'folder', null, groupName);
                } else if (groupContent) {
                    // Right-clicked on empty area of a folder
                    const groupWrap = groupContent.closest('.pb-group-wrap');
                    const groupTitleEl = groupWrap?.querySelector('.pb-group-title span:not(.pb-caret)');
                    const groupName = groupTitleEl?.innerText || 'General';
                    showContextMenu(e.clientX, e.clientY, 'folder-content', null, groupName);
                } else {
                    showContextMenu(e.clientX, e.clientY, 'sidebar', null);
                }
            });
        }
        
        // Hide context menu on click elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.pb-context-menu')) {
                hideContextMenu();
            }
            // Clear sidebar selection when clicking outside sidebar
            // Only clear if NOT clicking on a sidebar item (canvas or folder) and NOT inside a modal
            const clickedSidebarItem = e.target.closest('.pb-canvas-item, .pb-group-title');
            const inModal = e.target.closest('#pb-confirm-modal') || e.target.closest('#pb-prompt-modal');
            if (state.selectedSidebarItem && !clickedSidebarItem && !inModal) {
                state.selectedSidebarItem = null;
                updateSidebarSelection();
            }
        });
        
        // Global keyboard handler for sidebar canvas and canvas node operations
        document.addEventListener('keydown', (e) => {
            // Debug: Log key presses for Delete/Backspace
            if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'F2') {
                console.log('Keydown:', e.key);
                console.log('  selectedSidebarItem:', state.selectedSidebarItem);
                console.log('  target:', e.target.tagName, e.target.className);
                console.log('  contentEditable:', e.target.contentEditable);
            }
            
            // Handle Escape
            if (e.key === 'Escape') {
                hideContextMenu();
                if (state.selectedNodes.length > 0) {
                    clearSelection();
                }
                if (state.selectedSidebarItem) {
                    state.selectedSidebarItem = null;
                    updateSidebarSelection();
                }
            }
            
            // Don't process if in input/textarea or modal
            const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
            const isEditable = e.target.contentEditable === 'true';
            const inModal = e.target.closest('#pb-confirm-modal') || e.target.closest('#pb-prompt-modal');
            const inContextMenu = e.target.closest('.pb-context-menu');
            
            if (inModal || inContextMenu) return;
            
            // Delete selected sidebar item (canvas or folder) on Delete or Backspace
            if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedSidebarItem) {
                // Don't delete if in input/textarea or contentEditable element
                if (inInput || e.target.closest('[contenteditable="true"]')) return;
                
                e.preventDefault();
                
                if (state.selectedSidebarItem.startsWith('folder:')) {
                    // Delete folder
                    const folderName = state.selectedSidebarItem.replace('folder:', '');
                    deleteFolder(folderName);
                } else {
                    // Delete canvas
                    if (Object.keys(state.projects).length <= 1) {
                        showStatus('Cannot delete the last canvas', 'info');
                        return;
                    }
                    const canvasId = state.selectedSidebarItem;
                    const canvasName = state.projects[canvasId]?.name || 'this canvas';
                    
                    showConfirm(`Are you sure you want to permanently delete the canvas "${canvasName}"?`, () => {
                        delete state.projects[canvasId];
                        state.selectedSidebarItem = null;
                        updateSidebarSelection();
                        if (state.currentProjectId === canvasId) {
                            state.currentProjectId = Object.keys(state.projects)[0];
                            state.data = state.projects[state.currentProjectId].data;
                            state.canvasTransform = { x: 0, y: 0, scale: 1 };
                            updateTransform();
                            renderAll();
                        }
                        saveSilent();
                        renderSidebar();
                        showStatus(`Deleted "${canvasName}"`, 'info');
                    });
                }
            }
            
            // Delete selected canvas nodes on Delete or Backspace
            if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedNodes.length > 0 && !inInput && !isEditable) {
                e.preventDefault();
                deleteSelectedNodes();
                return;
            }
            
            // F2 to rename selected sidebar item (canvas or folder)
            if (e.key === 'F2' && state.selectedSidebarItem && !inInput && !isEditable) {
                e.preventDefault();
                if (state.selectedSidebarItem.startsWith('folder:')) {
                    const folderName = state.selectedSidebarItem.replace('folder:', '');
                    renameFolder(folderName);
                } else {
                    renameCanvas(state.selectedSidebarItem);
                }
                return;
            }
            
            // Arrow keys to navigate sidebar items (canvases and folders)
            if (state.selectedSidebarItem && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !inInput && !isEditable && !inContextMenu) {
                const allItems = [];
                
                // Get all folders
                document.querySelectorAll('.pb-group-title').forEach(el => {
                    const nameEl = el.querySelector('span:not(.pb-caret)');
                    if (nameEl) {
                        allItems.push({ type: 'folder', name: nameEl.innerText, element: el });
                    }
                });
                
                // Get all canvas items
                document.querySelectorAll('.pb-canvas-item').forEach(el => {
                    if (el.dataset.projId) {
                        allItems.push({ type: 'canvas', id: el.dataset.projId, element: el });
                    }
                });
                
                if (allItems.length === 0) return;
                
                // Find current selection index
                let currentIdx = -1;
                if (state.selectedSidebarItem.startsWith('folder:')) {
                    const folderName = state.selectedSidebarItem.replace('folder:', '');
                    currentIdx = allItems.findIndex(item => item.type === 'folder' && item.name === folderName);
                } else {
                    currentIdx = allItems.findIndex(item => item.type === 'canvas' && item.id === state.selectedSidebarItem);
                }
                
                if (currentIdx < 0) currentIdx = 0;
                
                let newIdx;
                if (e.key === 'ArrowUp') {
                    newIdx = currentIdx > 0 ? currentIdx - 1 : allItems.length - 1;
                } else {
                    newIdx = currentIdx < allItems.length - 1 ? currentIdx + 1 : 0;
                }
                
                const newItem = allItems[newIdx];
                if (newItem.type === 'folder') {
                    state.selectedSidebarItem = 'folder:' + newItem.name;
                } else {
                    state.selectedSidebarItem = newItem.id;
                }
                updateSidebarSelection();
                newItem.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });

        // Mouse down - Pan, Node drag, Start connection, Rectangle selection
        container.addEventListener('mousedown', (e) => {
            if (e.target.closest && (e.target.closest('.overlay-controls') || e.target.closest('.toolbar') || e.target.closest('.config-modal'))) return;

            // Focus container to ensure key events work
            container.focus();

            if (state.currentTool === 'pan') {
                state.isDraggingCanvas = true;
                state.startDragOffset = {
                    x: e.clientX - state.canvasTransform.x,
                    y: e.clientY - state.canvasTransform.y
                };
                return;
            }

            // Start rectangle selection on empty canvas
            const isNodeClick = e.target.closest('.node') !== null;
            const isPortClick = e.target.closest('.port') !== null;
            const isConnClick = e.target.closest('.connection-group') !== null;
            
            if (state.currentTool === 'select' && !isNodeClick && !isPortClick && !isConnClick) {
                state.isSelecting = true;
                const rect = container.getBoundingClientRect();
                state.selectionStartX = e.clientX - rect.left;
                state.selectionStartY = e.clientY - rect.top;
                
                // Create selection rectangle element
                if (!state.selectionRect) {
                    state.selectionRect = document.createElement('div');
                    state.selectionRect.className = 'selection-rect';
                    container.appendChild(state.selectionRect);
                }
                state.selectionRect.style.left = state.selectionStartX + 'px';
                state.selectionRect.style.top = state.selectionStartY + 'px';
                state.selectionRect.style.width = '0px';
                state.selectionRect.style.height = '0px';
                state.selectionRect.style.display = 'block';
                
                // Clear previous selection unless Shift is held
                if (!e.shiftKey && state.selectedNodes.length > 0) {
                    clearSelection();
                }
                return;
            }

            const portEl = e.target.closest ? e.target.closest('.port') : null;
            const nodeEl = e.target.closest ? e.target.closest('.node') : null;

            if (portEl && portEl.classList.contains('output')) {
                e.stopPropagation();
                state.isConnecting = true;
                const startNodeEl = portEl.closest('.node');
                const startNodeId = startNodeEl.id.replace('node-', '');
                const startPortIndex = parseInt(portEl.dataset.port, 10);

                state.connectionStart = {
                    nodeId: startNodeId,
                    portIndex: startPortIndex,
                    portEl: portEl
                };

                // Check if this output port already has a connection - show existing line
                const existingConn = state.data.connections.find(c => 
                    c.from === startNodeId && c.fromPort === startPortIndex
                );

                state.previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                state.previewLine.setAttribute('class', 'path-line preview-path');
                state.previewLine.setAttribute('stroke', 'var(--ichtus-orange)');
                
                if (existingConn) {
                    // Show the existing connection line too (different style)
                    const existingLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    existingLine.setAttribute('class', 'path-line existing-conn');
                    existingLine.setAttribute('stroke', '#888888');
                    existingLine.setAttribute('stroke-width', '4');
                    existingLine.setAttribute('stroke-dasharray', '6,4');
                    
                    const toNodeEl = document.getElementById(`node-${existingConn.to}`);
                    const toPorts = toNodeEl?.querySelectorAll('.port.input');
                    
                    if (toNodeEl && toPorts && toPorts[existingConn.toPort]) {
                        const toPort = toPorts[existingConn.toPort];
                        const containerRect = nodesContainer.getBoundingClientRect();
                        const fromRect = portEl.getBoundingClientRect();
                        const toRect = toPort.getBoundingClientRect();
                        
                        const fromX = (fromRect.left - containerRect.left + fromRect.width / 2) / state.canvasTransform.scale;
                        const fromY = (fromRect.top - containerRect.top + fromRect.height / 2) / state.canvasTransform.scale;
                        const toX = (toRect.left - containerRect.left + toRect.width / 2) / state.canvasTransform.scale;
                        const toY = (toRect.top - containerRect.top + toRect.height / 2) / state.canvasTransform.scale;
                        
                        const curvature = Math.max(Math.abs(toX - fromX) * 0.5, 50);
                        const d = `M ${fromX} ${fromY} C ${fromX + curvature} ${fromY}, ${toX - curvature} ${toY}, ${toX} ${toY}`;
                        existingLine.setAttribute('d', d);
                        svgCanvas.appendChild(existingLine);
                    }
                }
                
                svgCanvas.appendChild(state.previewLine);

            } else if (nodeEl) {
                e.stopPropagation();
                state.draggedNode = state.data.nodes.find(n => `node-${n.id}` === nodeEl.id);
                if (!state.draggedNode) return;

                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const scaledX = (mouseX - state.canvasTransform.x) / state.canvasTransform.scale;
                const scaledY = (mouseY - state.canvasTransform.y) / state.canvasTransform.scale;

                state.nodeDragOffset = { x: scaledX - state.draggedNode.x, y: scaledY - state.draggedNode.y };
            }
        });

        // Helper: highlight ports of a selected connection
        function highlightConnectionPorts(connIndex) {
            clearPortHighlights();
            const conn = state.data.connections[connIndex];
            if (!conn) return;
            
            const fromNode = document.getElementById(`node-${conn.from}`);
            const toNode = document.getElementById(`node-${conn.to}`);
            
            if (fromNode) {
                const fromPorts = fromNode.querySelectorAll('.port.output');
                if (fromPorts[conn.fromPort]) {
                    fromPorts[conn.fromPort].classList.add('port-highlighted');
                }
            }
            if (toNode) {
                const toPorts = toNode.querySelectorAll('.port.input');
                if (toPorts[conn.toPort]) {
                    toPorts[conn.toPort].classList.add('port-highlighted');
                }
            }
        }

        // Helper: clear all port highlights
        function clearPortHighlights() {
            document.querySelectorAll('.port-highlighted').forEach(p => {
                p.classList.remove('port-highlighted');
            });
        }

        // Mouse move
        window.addEventListener('mousemove', (e) => {
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const scaledX = (mouseX - state.canvasTransform.x) / state.canvasTransform.scale;
            const scaledY = (mouseY - state.canvasTransform.y) / state.canvasTransform.scale;

            // Update selection rectangle while dragging
            if (state.isSelecting && state.selectionRect) {
                const currentX = e.clientX - rect.left;
                const currentY = e.clientY - rect.top;
                
                const left = Math.min(state.selectionStartX, currentX);
                const top = Math.min(state.selectionStartY, currentY);
                const width = Math.abs(currentX - state.selectionStartX);
                const height = Math.abs(currentY - state.selectionStartY);
                
                state.selectionRect.style.left = left + 'px';
                state.selectionRect.style.top = top + 'px';
                state.selectionRect.style.width = width + 'px';
                state.selectionRect.style.height = height + 'px';
                
                // Highlight nodes that intersect with selection
                updateSelectionHighlight();
                return;
            }

            if (state.isConnecting) {
                const fromPort = state.connectionStart.portEl;
                const fromRect = fromPort.getBoundingClientRect();
                const containerRect = nodesContainer.getBoundingClientRect();
                
                const fromX = (fromRect.left - containerRect.left + fromRect.width / 2) / state.canvasTransform.scale;
                const fromY = (fromRect.top - containerRect.top + fromRect.height / 2) / state.canvasTransform.scale;

                const curvature = Math.max(Math.abs(scaledX - fromX) * 0.5, 50);
                state.previewLine.setAttribute('d', `M ${fromX} ${fromY} C ${fromX + curvature} ${fromY}, ${scaledX - curvature} ${scaledY}, ${scaledX} ${scaledY}`);

            } else if (state.isReconnecting) {
                // Reconnecting - drag from one endpoint to a different port
                const fromPort = state.reconnectingOtherPortEl;
                const fromRect = fromPort.getBoundingClientRect();
                const containerRect = nodesContainer.getBoundingClientRect();
                
                const fromX = (fromRect.left - containerRect.left + fromRect.width / 2) / state.canvasTransform.scale;
                const fromY = (fromRect.top - containerRect.top + fromRect.height / 2) / state.canvasTransform.scale;

                const curvature = Math.max(Math.abs(scaledX - fromX) * 0.5, 50);
                state.reconnectingPreviewLine.setAttribute('d', `M ${fromX} ${fromY} C ${fromX + curvature} ${fromY}, ${scaledX - curvature} ${scaledY}, ${scaledX} ${scaledY}`);

            } else if (state.isDraggingCanvas) {
                state.canvasTransform.x = e.clientX - state.startDragOffset.x;
                state.canvasTransform.y = e.clientY - state.startDragOffset.y;
                updateTransform();

            } else if (state.draggedNode) {
                state.draggedNode.x = scaledX - state.nodeDragOffset.x;
                state.draggedNode.y = scaledY - state.nodeDragOffset.y;

                document.getElementById(`node-${state.draggedNode.id}`).style.left = `${state.draggedNode.x}px`;
                document.getElementById(`node-${state.draggedNode.id}`).style.top = `${state.draggedNode.y}px`;
                renderConnections();
            }
        });

        // Mouse up - Complete connection, reconnection, or rectangle selection
        window.addEventListener('mouseup', (e) => {
            // Handle rectangle selection completion
            if (state.isSelecting) {
                state.isSelecting = false;
                
                // Select all nodes within the rectangle BEFORE hiding
                selectNodesInRect();
                
                // Now hide the selection rectangle
                if (state.selectionRect) {
                    state.selectionRect.style.display = 'none';
                }
                
                return;
            }
            
            // Handle reconnection completion
            if (state.isReconnecting) {
                const endPortEl = e.target.closest('.port');
                
                if (endPortEl) {
                    const endNodeEl = endPortEl.closest('.node');
                    const endNodeId = endNodeEl.id.replace('node-', '');
                    const endPortIndex = parseInt(endPortEl.dataset.port, 10);
                    const isOutput = endPortEl.classList.contains('output');
                    
                    // Determine the new connection endpoints
                    let newFrom, newFromPort, newTo, newToPort;
                    
                    if (state.reconnectingEnd === 'from') {
                        // Dragging FROM endpoint
                        newFrom = endNodeId;
                        newFromPort = endPortIndex;
                        newTo = state.reconnectingOriginalConn.to;
                        newToPort = state.reconnectingOriginalConn.toPort;
                        
                        // Can only connect output to input
                        if (!isOutput) {
                            // Swap - connect output to input
                            newFrom = state.reconnectingOriginalConn.to;
                            newFromPort = state.reconnectingOriginalConn.toPort;
                            newTo = endNodeId;
                            newToPort = endPortIndex;
                        }
                    } else {
                        // Dragging TO endpoint
                        newFrom = state.reconnectingOriginalConn.from;
                        newFromPort = state.reconnectingOriginalConn.fromPort;
                        newTo = endNodeId;
                        newToPort = endPortIndex;
                        
                        // Can only connect output to input
                        if (!isOutput) {
                            // Valid - output to input
                        } else {
                            // Swap - connect output to input
                            newFrom = endNodeId;
                            newFromPort = endPortIndex;
                            newTo = state.reconnectingOriginalConn.from;
                            newToPort = state.reconnectingOriginalConn.fromPort;
                        }
                    }
                    
                    // Don't connect to same node
                    if (newFrom !== newTo) {
                        // Check for duplicate (but allow reconnection of the same connection)
                        const isDuplicate = state.data.connections.some((c, idx) => 
                            idx !== state.reconnectingConnIndex &&
                            c.from === newFrom && c.fromPort === newFromPort &&
                            c.to === newTo && c.toPort === newToPort
                        );
                        
                        if (!isDuplicate) {
                            // Update the connection
                            state.data.connections[state.reconnectingConnIndex] = {
                                from: newFrom,
                                fromPort: newFromPort,
                                to: newTo,
                                toPort: newToPort,
                                type: state.reconnectingOriginalConn.type || 'audio',
                                cable: state.reconnectingOriginalConn.cable
                            };
                            renderConnections();
                            saveSilent();
                        }
                    }
                }
                
                // Clean up reconnection state
                if (state.reconnectingPreviewLine) {
                    state.reconnectingPreviewLine.remove();
                    state.reconnectingPreviewLine = null;
                }
                state.isReconnecting = false;
                state.reconnectingConnIndex = null;
                state.reconnectingEnd = null;
                state.reconnectingOtherPortEl = null;
                state.reconnectingOriginalConn = null;
                clearPortHighlights();
                return;
            }

            if (state.isConnecting) {
                const endPortEl = e.target.closest('.port.input');

                if (endPortEl) {
                    const endNodeEl = endPortEl.closest('.node');
                    const endNodeId = endNodeEl.id.replace('node-', '');
                    const endPortIndex = parseInt(endPortEl.dataset.port, 10);

                    if (state.connectionStart.nodeId !== endNodeId && !state.data.connections.some(c => 
                        c.from === state.connectionStart.nodeId && c.fromPort === state.connectionStart.portIndex &&
                        c.to === endNodeId && c.toPort === endPortIndex
                    )) {
                        state.data.connections.push({
                            from: state.connectionStart.nodeId,
                            fromPort: state.connectionStart.portIndex,
                            to: endNodeId,
                            toPort: endPortIndex,
                            type: 'audio',
                            cable: 'XLR'
                        });
                        renderConnections();
                        saveSilent();
                    }
                }

                // Also remove any existing-conn lines
                document.querySelectorAll('.existing-conn').forEach(el => el.remove());
                
                if (state.previewLine) {
                    state.previewLine.remove();
                    state.previewLine = null;
                }
                state.isConnecting = false;
                state.connectionStart = null;
            }

            state.isDraggingCanvas = false;
            state.draggedNode = null;
        });

        // Click - Node menu, connection buttons, and connection selection
        container.addEventListener('click', (e) => {
            if (state.currentTool !== 'select') return;

            const menuBtn = e.target.closest && e.target.closest('.node-menu-btn');
            if (menuBtn) {
                e.stopPropagation();
                openNodeConfig(menuBtn.dataset.nodeId);
                return;
            }

            const connBtn = e.target.closest && e.target.closest('.conn-btn');
            if (connBtn) {
                e.stopPropagation();
                const idx = parseInt(connBtn.getAttribute('data-index'), 10);
                if (!isNaN(idx)) {
                    if (connBtn.classList.contains('delete')) {
                        showConfirm('Weet je zeker dat je deze verbinding wilt verwijderen?', () => {
                            state.data.connections.splice(idx, 1);
                            state.selectedConnectionIndex = null;
                            clearPortHighlights();
                            renderConnections();
                            saveSilent();
                        });
                    } else if (connBtn.classList.contains('edit')) {
                        state.selectedConnectionIndex = idx;
                        highlightConnectionPorts(idx);
                        renderConnections();
                        openConnConfig(idx);
                    }
                }
                return;
            }

            // Click on connection path to select it
            const connGroup = e.target.closest && e.target.closest('.connection-group');
            if (connGroup) {
                e.stopPropagation();
                const idx = parseInt(connGroup.getAttribute('data-index'), 10);
                if (!isNaN(idx)) {
                    // Toggle selection - click again to deselect
                    if (state.selectedConnectionIndex === idx) {
                        state.selectedConnectionIndex = null;
                        clearPortHighlights();
                    } else {
                        state.selectedConnectionIndex = idx;
                        highlightConnectionPorts(idx);
                    }
                    renderConnections();
                }
                return;
            }

            // Click on empty canvas - deselect connection
            if (!e.target.closest('.node') && !e.target.closest('.port')) {
                if (state.selectedConnectionIndex !== null) {
                    state.selectedConnectionIndex = null;
                    clearPortHighlights();
                    renderConnections();
                }
            }
        });

        // Zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const zoomAmount = e.deltaY * -0.001;
            const newScale = Math.min(Math.max(0.2, state.canvasTransform.scale + zoomAmount), 3);
            
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            state.canvasTransform.x = mouseX - (mouseX - state.canvasTransform.x) * (newScale / state.canvasTransform.scale);
            state.canvasTransform.y = mouseY - (mouseY - state.canvasTransform.y) * (newScale / state.canvasTransform.scale);
            state.canvasTransform.scale = newScale;
            
            updateTransform();
        }, { passive: false });

        // Touch events for iPad
        container.addEventListener('touchstart', handleTouchStart, { passive: false });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd, { passive: false });

        // Port drag for reconnection (mouse)
        container.addEventListener('mousedown', (e) => {
            const portEl = e.target.closest ? e.target.closest('.port') : null;
            
            if (portEl && state.selectedConnectionIndex !== null) {
                const conn = state.data.connections[state.selectedConnectionIndex];
                if (!conn) return;
                
                const nodeEl = portEl.closest('.node');
                const nodeId = nodeEl.id.replace('node-', '');
                const portIndex = parseInt(portEl.dataset.port, 10);
                
                // Check if this port is an endpoint of the selected connection
                const isFromEndpoint = nodeId == conn.from && portIndex === conn.fromPort && portEl.classList.contains('output');
                const isToEndpoint = nodeId == conn.to && portIndex === conn.toPort && portEl.classList.contains('input');
                
                if (isFromEndpoint || isToEndpoint) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // CANCEL any ongoing node drag to prevent stuck state
                    state.draggedNode = null;
                    state.isDraggingCanvas = false;
                    
                    // Start reconnection mode
                    state.isReconnecting = true;
                    state.reconnectingConnIndex = state.selectedConnectionIndex;
                    state.reconnectingEnd = isFromEndpoint ? 'from' : 'to';
                    state.reconnectingOriginalConn = { ...conn };
                    state.reconnectingOtherPortEl = portEl;
                    
                    // Create preview line
                    state.reconnectingPreviewLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    state.reconnectingPreviewLine.setAttribute('class', 'path-line preview-path reconnecting');
                    state.reconnectingPreviewLine.setAttribute('stroke', 'var(--ichtus-orange)');
                    state.reconnectingPreviewLine.setAttribute('stroke-dasharray', '8,4');
                    svgCanvas.appendChild(state.reconnectingPreviewLine);
                    
                    return;
                }
            }
        });
    }

    // ==================== TOUCH HANDLING ====================

    function handleTouchStart(e) {
        if (e.touches.length === 2) {
            // Start pinch zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            state.pinchStartDist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
            state.pinchStartScale = state.canvasTransform.scale;
            state.pinchCenterX = (touch1.clientX + touch2.clientX) / 2;
            state.pinchCenterY = (touch1.clientY + touch2.clientY) / 2;
            return;
        }

        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        
        if (target.closest('.overlay-controls') || target.closest('.toolbar') || target.closest('.config-modal')) return;

        const portEl = target.closest ? target.closest('.port') : null;
        const nodeEl = target.closest ? target.closest('.node') : null;

        if (portEl && portEl.classList.contains('output')) {
            e.preventDefault();
            state.touchDragActive = true;
            state.touchDragType = 'connection';
            state.touchDragElement = portEl;
            
            const startNodeEl = portEl.closest('.node');
            state.connectionStart = {
                nodeId: startNodeEl.id.replace('node-', ''),
                portIndex: parseInt(portEl.dataset.port, 10),
                portEl: portEl
            };

            state.previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            state.previewLine.setAttribute('class', 'path-line preview-path');
            state.previewLine.setAttribute('stroke', 'var(--ichtus-orange)');
            svgCanvas.appendChild(state.previewLine);

            state.touchDragStartX = touch.clientX;
            state.touchDragStartY = touch.clientY;
            state.touchDragLastX = touch.clientX;
            state.touchDragLastY = touch.clientY;

        } else if (nodeEl) {
            e.preventDefault();
            state.touchDragActive = true;
            state.touchDragType = 'node';
            state.touchDragElement = nodeEl;
            state.touchDragId = nodeEl.id.replace('node-', '');
            
            state.draggedNode = state.data.nodes.find(n => n.id == state.touchDragId);
            if (!state.draggedNode) return;

            const rect = container.getBoundingClientRect();
            const mouseX = touch.clientX - rect.left;
            const mouseY = touch.clientY - rect.top;
            const scaledX = (mouseX - state.canvasTransform.x) / state.canvasTransform.scale;
            const scaledY = (mouseY - state.canvasTransform.y) / state.canvasTransform.scale;

            state.nodeDragOffset = { x: scaledX - state.draggedNode.x, y: scaledY - state.draggedNode.y };
            state.touchDragStartX = touch.clientX;
            state.touchDragStartY = touch.clientY;
            state.touchDragLastX = touch.clientX;
            state.touchDragLastY = touch.clientY;
            state.touchDragMoved = false;

        } else if (state.currentTool === 'pan') {
            state.touchDragActive = true;
            state.touchDragType = 'pan';
            state.touchDragStartX = touch.clientX;
            state.touchDragStartY = touch.clientY;
            state.startDragOffset = {
                x: state.canvasTransform.x,
                y: state.canvasTransform.y
            };
        }
    }

    function handleTouchMove(e) {
        if (e.touches.length === 2) {
            // Pinch zoom
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const dist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
            const scale = dist / state.pinchStartDist;
            const newScale = Math.min(Math.max(0.2, state.pinchStartScale * scale), 3);
            
            const rect = container.getBoundingClientRect();
            const mouseX = state.pinchCenterX - rect.left;
            const mouseY = state.pinchCenterY - rect.top;
            
            state.canvasTransform.x = mouseX - (mouseX - state.canvasTransform.x) * (newScale / state.canvasTransform.scale);
            state.canvasTransform.y = mouseY - (mouseY - state.canvasTransform.y) * (newScale / state.canvasTransform.scale);
            state.canvasTransform.scale = newScale;
            
            updateTransform();
            return;
        }

        if (!state.touchDragActive || e.touches.length !== 1) return;
        e.preventDefault();

        const touch = e.touches[0];

        if (state.touchDragType === 'connection') {
            const fromPort = state.connectionStart.portEl;
            const fromRect = fromPort.getBoundingClientRect();
            const containerRect = nodesContainer.getBoundingClientRect();
            
            const fromX = (fromRect.left - containerRect.left + fromRect.width / 2) / state.canvasTransform.scale;
            const fromY = (fromRect.top - containerRect.top + fromRect.height / 2) / state.canvasTransform.scale;

            const rect = container.getBoundingClientRect();
            const scaledX = (touch.clientX - rect.left - state.canvasTransform.x) / state.canvasTransform.scale;
            const scaledY = (touch.clientY - rect.top - state.canvasTransform.y) / state.canvasTransform.scale;

            const curvature = Math.max(Math.abs(scaledX - fromX) * 0.5, 50);
            state.previewLine.setAttribute('d', `M ${fromX} ${fromY} C ${fromX + curvature} ${fromY}, ${scaledX - curvature} ${scaledY}, ${scaledX} ${scaledY}`);

        } else if (state.touchDragType === 'node') {
            state.touchDragMoved = true;
            
            const rect = container.getBoundingClientRect();
            const mouseX = touch.clientX - rect.left;
            const mouseY = touch.clientY - rect.top;
            const scaledX = (mouseX - state.canvasTransform.x) / state.canvasTransform.scale;
            const scaledY = (mouseY - state.canvasTransform.y) / state.canvasTransform.scale;

            state.draggedNode.x = scaledX - state.nodeDragOffset.x;
            state.draggedNode.y = scaledY - state.nodeDragOffset.y;

            const el = document.getElementById(`node-${state.draggedNode.id}`);
            if (el) {
                el.style.left = `${state.draggedNode.x}px`;
                el.style.top = `${state.draggedNode.y}px`;
            }
            renderConnections();

        } else if (state.touchDragType === 'pan') {
            state.canvasTransform.x = state.startDragOffset.x + (touch.clientX - state.touchDragStartX);
            state.canvasTransform.y = state.startDragOffset.y + (touch.clientY - state.touchDragStartY);
            updateTransform();
        }

        state.touchDragLastX = touch.clientX;
        state.touchDragLastY = touch.clientY;
    }

    function handleTouchEnd(e) {
        if (!state.touchDragActive) return;

        if (state.touchDragType === 'connection') {
            const touch = e.changedTouches[0];
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const endPortEl = target?.closest ? target.closest('.port.input') : null;

            if (endPortEl && state.connectionStart) {
                const endNodeEl = endPortEl.closest('.node');
                const endNodeId = endNodeEl.id.replace('node-', '');
                const endPortIndex = parseInt(endPortEl.dataset.port, 10);

                if (state.connectionStart.nodeId !== endNodeId && !state.data.connections.some(c => 
                    c.from === state.connectionStart.nodeId && c.fromPort === state.connectionStart.portIndex &&
                    c.to === endNodeId && c.toPort === endPortIndex
                )) {
                    state.data.connections.push({
                        from: state.connectionStart.nodeId,
                        fromPort: state.connectionStart.portIndex,
                        to: endNodeId,
                        toPort: endPortIndex,
                        type: 'audio',
                        cable: 'XLR'
                    });
                    renderConnections();
                    saveSilent();
                }
            }

            if (state.previewLine) {
                state.previewLine.remove();
                state.previewLine = null;
            }
            state.connectionStart = null;

        } else if (state.touchDragType === 'node' && state.touchDragMoved) {
            saveSilent();
        }

        state.touchDragActive = false;
        state.touchDragType = null;
        state.touchDragElement = null;
        state.touchDragId = null;
        state.draggedNode = null;
    }

    // ==================== UI BUTTON HANDLERS ====================

    function initUIEvents() {
        // Sidebar toggle
        const menuToggle = document.getElementById('pb-menu-toggle');
        if (menuToggle) {
            menuToggle.addEventListener('click', () => {
                const isOpen = pbSidebar.classList.contains('open');
                if (isOpen) {
                    pbSidebar.classList.remove('open');
                    menuToggle.classList.remove('open');
                    document.body.classList.remove('pb-sidebar-open');
                    localStorage.setItem('pb_sidebar_open', 'false');
                } else {
                    pbSidebar.classList.add('open');
                    menuToggle.classList.add('open');
                    document.body.classList.add('pb-sidebar-open');
                    localStorage.setItem('pb_sidebar_open', 'true');
                }
            });
        }


        
        // Restore pb-sidebar state from localStorage
        const savedSidebarOpen = localStorage.getItem('pb_sidebar_open') === 'true';
        if (savedSidebarOpen) {
            const pbSidebarEl = document.getElementById('pb-sidebar');
            const menuToggleEl = document.getElementById('pb-menu-toggle');
            if (pbSidebarEl && menuToggleEl) {
                pbSidebarEl.classList.add('open');
                menuToggleEl.classList.add('open');
                document.body.classList.add('pb-sidebar-open');
            }
        }
        // Tool buttons
        const btnToolSelect = document.getElementById('btn-tool-select');
        const btnToolPan = document.getElementById('btn-tool-pan');
        
        if (btnToolSelect) {
            btnToolSelect.addEventListener('click', () => {
                state.currentTool = 'select';
                btnToolSelect.classList.add('active');
                btnToolPan?.classList.remove('active');
                container.setAttribute('data-tool', 'select');
            });
        }
        
        if (btnToolPan) {
            btnToolPan.addEventListener('click', () => {
                state.currentTool = 'pan';
                btnToolPan.classList.add('active');
                btnToolSelect?.classList.remove('active');
                container.setAttribute('data-tool', 'pan');
            });
        }

        // Add node
        const btnAddNode = document.getElementById('btn-add-node');
        if (btnAddNode) {
            btnAddNode.addEventListener('click', () => {
                const rect = container.getBoundingClientRect();
                const centerX = (rect.width / 2 - state.canvasTransform.x) / state.canvasTransform.scale;
                const centerY = (rect.height / 2 - state.canvasTransform.y) / state.canvasTransform.scale;

                const newNode = {
                    id: 'node_' + Date.now(),
                    title: 'New Device',
                    ip: '0.0.0.0',
                    x: centerX - 80,
                    y: centerY - 50,
                    inputs: ['Input 1'],
                    outputs: ['Output 1']
                };

                state.data.nodes.push(newNode);
                renderAll();
                saveSilent();
                
                setTimeout(() => openNodeConfig(newNode.id), 50);
            });
        }

        // Add canvas
        const btnAddFile = document.getElementById('btn-add-file');
        if (btnAddFile) {
            btnAddFile.addEventListener('click', () => {
                const currentGroup = state.projects[state.currentProjectId]?.group || 'General';
                const id = 'proj_' + Date.now();
                state.projects[id] = { id, name: 'New Canvas', group: currentGroup, data: { nodes: [], connections: [] } };
                saveSilent();
                switchCanvas(id);
            });
        }

        // Add folder
        const btnAddFolder = document.getElementById('btn-add-folder');
        if (btnAddFolder) {
            btnAddFolder.addEventListener('click', () => {
                const content = document.getElementById('pb-sidebar-content');

                const groupTitle = document.createElement('div');
                groupTitle.className = 'pb-group-title';
                
                const newSpan = document.createElement('span');
                newSpan.innerText = 'New Folder';
                newSpan.contentEditable = 'true';
                newSpan.style.outline = 'none';
                newSpan.style.borderBottom = '1px solid var(--ichtus-orange)';
                newSpan.style.flex = '1';
                
                groupTitle.appendChild(newSpan);
                
                const groupWrap = document.createElement('div');
                groupWrap.className = 'pb-group-wrap';
                groupWrap.appendChild(groupTitle);
                content.insertBefore(groupWrap, content.firstChild);
                
                newSpan.focus();
                
                const range = document.createRange();
                range.selectNodeContents(newSpan);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                
                let isEditing = true;
                const finishEdit = (e) => {
                    if (!isEditing) return;
                    if (e.type === 'keydown' && e.key !== 'Enter') return;
                    if (e.key === 'Enter') e.preventDefault();
                    
                    isEditing = false;
                    newSpan.contentEditable = 'false';
                    const finalGroupName = newSpan.innerText.trim();
                    
                    if (finalGroupName) {
                        const id = 'proj_' + Date.now();
                        state.projects[id] = { id, name: 'Blank Canvas', group: finalGroupName, data: { nodes: [], connections: [] } };
                        saveSilent();
                    }
                    renderSidebar();
                };
                
                newSpan.addEventListener('blur', finishEdit);
                newSpan.addEventListener('keydown', finishEdit);
            });
        }

        // Import canvases
        document.getElementById('btn-import-file')?.addEventListener('click', () => {
            handleImportCanvases();
        });

        // Linked networking filter
        document.getElementById('linked-networking')?.addEventListener('change', (e) => {
            document.querySelectorAll('.connection-group').forEach(group => {
                const path = group.querySelector('.path-line');
                if (path) {
                    group.style.opacity = (e.target.checked && path.getAttribute('data-type') !== 'network') ? '0.1' : '1';
                }
            });
        });

        // AI import button
        document.getElementById('ai-import-btn')?.addEventListener('click', () => {
            alert('AI Import ready hook! Paste prompt text here to build nodes.');
        });

        // Fit screen button - zoom to fit all nodes
        const btnFitScreen = document.getElementById('btn-fit-screen');
        if (btnFitScreen) {
            btnFitScreen.addEventListener('click', () => {
                fitAllNodesToScreen();
            });
        }

        // Reset view button
        const btnResetView = document.getElementById('btn-reset-view');
        if (btnResetView) {
            btnResetView.addEventListener('click', () => {
                resetView();
            });
        }

        // Edit mode toggle
        const btnEditSidebar = document.getElementById('btn-edit-sidebar');
        if (btnEditSidebar) {
            btnEditSidebar.addEventListener('click', () => {
                state.editMode = !state.editMode;
                const pbSidebarEl = document.getElementById('pb-sidebar');
                if (pbSidebarEl) {
                    pbSidebarEl.classList.toggle('edit-mode', state.editMode);
                }
                btnEditSidebar.classList.toggle('active', state.editMode);
                localStorage.setItem('patchbay_edit_mode', state.editMode ? 'true' : 'false');
            });
            // Restore edit mode state
            if (state.editMode) {
                const pbSidebarEl = document.getElementById('pb-sidebar');
                if (pbSidebarEl) pbSidebarEl.classList.add('edit-mode');
                btnEditSidebar.classList.add('active');
            }
        }
    }

    function handleImportCanvases() {
        console.log('DEBUG [handleImportCanvases]: Function called');
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.multiple = true;
        
        input.onchange = async (e) => {
            console.log('DEBUG [handleImportCanvases]: onchange triggered, files:', e.target.files?.length || 0);
            for (const file of e.target.files) {
                console.log('DEBUG [handleImportCanvases]: Processing file:', file.name);
                try {
                    const text = await file.text();
                    console.log('DEBUG [handleImportCanvases]: File content length:', text.length, 'chars');
                    const data = JSON.parse(text);
                    console.log('DEBUG [handleImportCanvases]: JSON parsed, has nodes:', !!data.nodes, 'connections:', !!data.connections);
                    console.log('DEBUG [handleImportCanvases]: Top-level keys:', JSON.stringify(Object.keys(data)));
                    console.log('DEBUG [handleImportCanvases]: First 500 chars:', JSON.stringify(data).substring(0, 500));
                    console.log('DEBUG [handleImportCanvases]: nodes count:', data.nodes?.length, 'connections count:', data.connections?.length);
                    
                    // Check if it's a folder format (has canvases array)
                    if (data.canvases && Array.isArray(data.canvases)) {
                        console.log('DEBUG [handleImportCanvases]: Detected FOLDER format with', data.canvases.length, 'canvas(es)');
                        
                        // Import each canvas from the folder
                        data.canvases.forEach((canvas, idx) => {
                            const id = 'proj_' + Date.now() + '_' + idx;
                            const canvasName = canvas.name || 'Imported Canvas ' + (idx + 1);
                            const canvasGroup = data.name || 'Imported';
                            
                            console.log('DEBUG [handleImportCanvases]: Importing canvas:', canvasName, 'with id:', id);
                            
                            state.projects[id] = {
                                id,
                                name: canvasName,
                                group: canvasGroup,
                                data: canvas.data || { nodes: [], connections: [] }
                            };
                            
                            console.log('DEBUG [handleImportCanvases]: Canvas imported, total projects:', Object.keys(state.projects).length);
                        });
                    }
                    // Check if it's a direct canvas format (has nodes and connections at top level)
                    else if (data.nodes && data.connections) {
                        const id = 'proj_' + Date.now();
                        console.log('DEBUG [handleImportCanvases]: Detected CANVAS format');
                        console.log('DEBUG [handleImportCanvases]: Creating project with id:', id);
                        state.projects[id] = { 
                            id, 
                            name: file.name.replace('.json', '').replace('.ichtus-folder', ''),
                            group: 'Imported', 
                            data: data 
                        };
                        console.log('DEBUG [handleImportCanvases]: Project added, total projects:', Object.keys(state.projects).length);
                    } else {
                        console.log('DEBUG [handleImportCanvases]: SKIPPED - unknown format, keys:', Object.keys(data));
                    }
                } catch (err) {
                    console.error('DEBUG [handleImportCanvases]: FAILED', file.name, err);
                }
            }
            console.log('DEBUG [handleImportCanvases]: Calling saveSilent and renderSidebar');
            saveSilent();
            renderSidebar();
            console.log('DEBUG [handleImportCanvases]: Import complete');
        };
        
        input.click();
    }

    // ==================== INITIALIZATION ====================
    function init() {
        // Prevent re-initialization if already initialized (prevents duplicate event listeners)
        if (state.initialized) {
            // Restore sidebar state from localStorage
            const savedSidebarOpen = localStorage.getItem('pb_sidebar_open') === 'true';
            const pbSidebarEl = document.getElementById('pb-sidebar');
            const menuToggleEl = document.getElementById('pb-menu-toggle');
            if (pbSidebarEl && menuToggleEl) {
                if (savedSidebarOpen) {
                    pbSidebarEl.classList.add('open');
                    menuToggleEl.classList.add('open');
                    document.body.classList.add('pb-sidebar-open');
                } else {
                    pbSidebarEl.classList.remove('open');
                    menuToggleEl.classList.remove('open');
                    document.body.classList.remove('pb-sidebar-open');
                }
            }
            return;
        }
        
        container = document.getElementById('canvas-container');
        nodesContainer = document.getElementById('nodes-container');
        svgCanvas = document.getElementById('svg-canvas');
        pbSidebar = document.getElementById('pb-sidebar');

        if (!container || !nodesContainer || !svgCanvas) {
            console.warn('Patchbay container elements not found');
            return;
        }

        initEventListeners();
        initUIEvents();
        loadData();
        updateTransform();
        state.initialized = true;
    }

    // Return public API
    return {
        init,
        getData,
        getProjects,
        getCurrentProjectId,
        getCanvasTransform,
        renderAll,
        renderSidebar,
        switchCanvas,
        saveData,
        openNodeConfig,
        openConnConfig
    };

    // ==================== HELPER FUNCTIONS ====================

    // Fit all nodes to screen
    function fitAllNodesToScreen() {
        if (!container || state.data.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        state.data.nodes.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + 180);
            maxY = Math.max(maxY, node.y + 100);
        });

        const padding = 80;
        const containerRect = container.getBoundingClientRect();
        const contentWidth = maxX - minX + padding * 2;
        const contentHeight = maxY - minY + padding * 2;

        const scaleX = containerRect.width / contentWidth;
        const scaleY = containerRect.height / contentHeight;
        const newScale = Math.min(Math.max(0.2, Math.min(scaleX, scaleY)), 2);

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        state.canvasTransform.scale = newScale;
        state.canvasTransform.x = containerRect.width / 2 - centerX * newScale;
        state.canvasTransform.y = containerRect.height / 2 - centerY * newScale;

        updateTransform();
    }

    // Reset view to default
    function resetView() {
        state.canvasTransform = { x: 0, y: 0, scale: 1 };
        updateTransform();
    }

    return {
        init,
        getData,
        getProjects,
        getCurrentProjectId,
        getCanvasTransform,
        renderAll,
        renderSidebar,
        switchCanvas,
        saveData,
        openNodeConfig,
        openConnConfig,
        fitAllNodesToScreen,
        resetView,
        exportAllProjects,
        exportSingleProject,
        exportCanvas
    };
})();

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const pbSidebarEl = document.getElementById('pb-sidebar');
        if (pbSidebarEl && !pbSidebarEl.classList.contains('open')) {
            pbSidebarEl.classList.add('open');
            const menuToggle = document.getElementById('pb-menu-toggle');
            if (menuToggle) menuToggle.classList.add('open');
            document.body.classList.add('pb-sidebar-open');
        }
    });
} else {
    const pbSidebarEl = document.getElementById('pb-sidebar');
    if (pbSidebarEl && !pbSidebarEl.classList.contains('open')) {
        pbSidebarEl.classList.add('open');
        const menuToggle = document.getElementById('pb-menu-toggle');
        if (menuToggle) menuToggle.classList.add('open');
        document.body.classList.add('pb-sidebar-open');
    }
}