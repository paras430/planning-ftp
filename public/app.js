document.addEventListener('DOMContentLoaded', () => {
    // Theme Toggling
    const themeToggle = document.getElementById('theme-toggle');
    const moonIcon = document.getElementById('moon-icon');
    const sunIcon = document.getElementById('sun-icon');
    
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });

    function updateThemeIcon(theme) {
        if (theme === 'dark') {
            moonIcon.style.display = 'none';
            sunIcon.style.display = 'block';
        } else {
            moonIcon.style.display = 'block';
            sunIcon.style.display = 'none';
        }
    }

    // Folders Definition
    const FOLDERS = [
        { name: 'Optical Plan', color: 'var(--c-blue)' },
        { name: 'Microwave Plan', color: 'var(--c-purple)' },
        { name: 'Progress', color: 'var(--c-green)' },
        { name: 'KMLs', color: 'var(--c-orange)' },
        { name: 'LETTERS', color: 'var(--c-pink)' },
        { name: 'MOMS', color: 'var(--c-pink)' },
        { name: 'Misc', color: 'var(--c-gray)' },
        { name: 'Reference Docs', color: 'var(--c-teal)' }
    ];

    // Auth & UI State
    let authHeader = sessionStorage.getItem('auth') || '';
    let currentUsername = sessionStorage.getItem('username') || '';
    let currentRole = sessionStorage.getItem('role') || 'Viewer';
    let allFiles = [];
    let currentActiveFolder = null; // null means 'All Files'
    let currentActiveSubfolder = null;
    let visibleCount = 5;

    const loginScreen = document.getElementById('login-screen');
    const appMain = document.getElementById('app-main');
    const userProfile = document.getElementById('user-profile');
    const displayUsername = document.getElementById('display-username');
    const btnLogout = document.getElementById('btn-logout');
    const loginForm = document.getElementById('login-form');
    const loginStatus = document.getElementById('login-status');
    
    // UI Elements
    const filesBody = document.getElementById('files-body');
    const searchInput = document.getElementById('search-input');
    const dashboardGrid = document.getElementById('dashboard-grid');
    const tableTitle = document.getElementById('table-title');
    const colFolder = document.getElementById('col-folder');
    const folderDropdownTemplate = document.getElementById('folder-dropdown-template');
    const btnBack = document.getElementById('btn-back');
    const btnLoadMore = document.getElementById('btn-load-more');
    const btnBackupFolder = document.getElementById('btn-backup-folder');

    // Auth Initialization
    function checkAuth() {
        if (authHeader) {
            loginScreen.classList.add('hidden');
            appMain.classList.remove('hidden');
            userProfile.classList.remove('hidden');
            document.getElementById('username-text').textContent = currentUsername || 'User';
            
            // Show/hide Delete button based on role
            if (currentRole === 'Master') {
                btnBulkDelete.classList.remove('hidden');
            } else {
                btnBulkDelete.classList.add('hidden');
            }
            
            // Show/hide Edit button based on role
            if (currentRole === 'Viewer') {
                btnBulkEdit.classList.add('hidden');
            } else {
                btnBulkEdit.classList.remove('hidden');
            }
            
            loadFiles();
        } else {
            loginScreen.classList.remove('hidden');
            appMain.classList.add('hidden');
            userProfile.classList.add('hidden');
            // Try fetching anyway in case auth is disabled or already cached by browser
            fetchAuth('/api/files', {}, true).then(res => {
                if(res.ok) {
                    authHeader = 'anonymous'; // Skip login
                    currentRole = 'Master'; // Default to Master when auth disabled
                    checkAuth();
                }
            }).catch(() => {});
        }
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('login-username').value;
        const p = document.getElementById('login-password').value;
        
        loginStatus.textContent = 'Logging in...';
        loginStatus.className = 'status-msg';

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                authHeader = 'Basic ' + btoa(u + ':' + p);
                currentUsername = data.username || 'User';
                currentRole = data.role || 'Viewer';
                sessionStorage.setItem('auth', authHeader);
                sessionStorage.setItem('username', currentUsername);
                sessionStorage.setItem('role', currentRole);
                checkAuth();
            } else {
                loginStatus.textContent = data.error || 'Login failed';
                loginStatus.className = 'status-msg error';
            }
        } catch (err) {
            loginStatus.textContent = 'Error logging in';
            loginStatus.className = 'status-msg error';
        }
    });

    displayUsername.addEventListener('click', () => {
        btnLogout.classList.toggle('hidden');
    });

    btnLogout.addEventListener('click', () => {
        sessionStorage.removeItem('auth');
        sessionStorage.removeItem('username');
        window.location.reload();
    });

    async function fetchAuth(url, options = {}, skipReload = false) {
        if (!options.headers) options.headers = {};
        if (authHeader && authHeader !== 'anonymous') {
            options.headers['X-Auth-Token'] = authHeader;
        }
        
        const res = await fetch(url, options);
        if (res.status === 401 && url !== '/api/login' && !skipReload) {
            sessionStorage.removeItem('auth');
            sessionStorage.removeItem('username');
            window.location.reload();
        }
        return res;
    }

    const btnHome = document.getElementById('btn-home');
    if (btnHome) {
        btnHome.addEventListener('click', () => {
            currentActiveFolder = null;
            currentActiveSubfolder = null;
            searchInput.value = '';
            visibleCount = 5;
            renderDashboard();
            applyCurrentFilter();
        });
    }

    btnBack.addEventListener('click', () => {
        if (currentActiveSubfolder) {
            currentActiveSubfolder = null;
        } else {
            currentActiveFolder = null;
        }
        searchInput.value = '';
        visibleCount = 5;
        renderDashboard();
        applyCurrentFilter();
    });

    btnLoadMore.addEventListener('click', () => {
        visibleCount += 5;
        applyCurrentFilter();
    });

    btnBackupFolder.addEventListener('click', async () => {
        if (!currentActiveFolder || !currentActiveSubfolder) return;
        const originalText = btnBackupFolder.innerHTML;
        btnBackupFolder.disabled = true;
        btnBackupFolder.innerHTML = `
            <div class="loader" style="width: 14px; height: 14px; border-width: 2px; display: inline-block;"></div>
            <span>Zipping Folder...</span>
        `;
        try {
            const subfolderYear = currentActiveSubfolder.split('_')[1] || '';
            const downloadUrl = `/api/backup-zip?token=${encodeURIComponent(authHeader)}&folder=${encodeURIComponent(currentActiveFolder)}&year=${encodeURIComponent(subfolderYear)}`;
            const response = await fetchAuth(downloadUrl);
            if (!response.ok) {
                const errData = await response.json();
                alert(errData.error || 'Failed to create backup zip');
                return;
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `ftp_files_backup_${currentActiveSubfolder}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error(err);
            alert('An error occurred while zipping folder.');
        } finally {
            btnBackupFolder.disabled = false;
            btnBackupFolder.innerHTML = originalText;
        }
    });

    // Bulk Actions Elements
    const selectAll = document.getElementById('select-all');
    const btnBulkEdit = document.getElementById('btn-bulk-edit');
    const btnBulkSave = document.getElementById('btn-bulk-save');
    const btnBulkDelete = document.getElementById('btn-bulk-delete');

    selectAll.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkButtons();
    });

    function updateBulkButtons() {
        const checkboxes = document.querySelectorAll('.row-checkbox:checked');
        const count = checkboxes.length;
        btnBulkEdit.disabled = count === 0;
        btnBulkDelete.disabled = count === 0;
    }

    btnBulkEdit.addEventListener('click', () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        checked.forEach(cb => {
            const tr = cb.closest('tr');
            toggleEditMode(tr, true);
        });
        btnBulkEdit.classList.add('hidden');
        btnBulkSave.classList.remove('hidden');
    });

    btnBulkSave.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        let allOk = true;
        
        for (const cb of checked) {
            const tr = cb.closest('tr');
            const filename = cb.value;
            const newYear = tr.nextElementSibling.querySelector('.edit-year').value;
            const newRemarks = tr.querySelector('.edit-remarks').value;
            const newFolder = tr.querySelector('.edit-folder').value;

            if (newYear && !/^\d{4}$/.test(newYear)) {
                alert(`Failed to save ${filename}: Year must be a 4-digit integer.`);
                allOk = false;
                continue;
            }

            try {
                const response = await fetchAuth(`/api/files/${filename}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: newYear, remarks: newRemarks, folder: newFolder })
                });
                if (!response.ok) allOk = false;
            } catch (error) {
                allOk = false;
            }
        }
        
        btnBulkEdit.classList.remove('hidden');
        btnBulkSave.classList.add('hidden');
        selectAll.checked = false;
        
        if (!allOk) alert('Some files failed to save.');
        loadFiles();
    });

    btnBulkDelete.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        if (!confirm(`Are you sure you want to delete ${checked.length} files?`)) return;

        for (const cb of checked) {
            await fetchAuth(`/api/files/${cb.value}`, { method: 'DELETE' });
        }
        selectAll.checked = false;
        loadFiles();
    });

    // File Upload
    const uploadForm = document.getElementById('upload-form');
    const uploadBtn = document.getElementById('upload-btn');
    const uploadLoader = document.getElementById('upload-loader');
    const uploadStatus = document.getElementById('upload-status');
    const fileInput = document.getElementById('file-input');

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const file = fileInput.files[0];
        if (file && file.size > 30 * 1024 * 1024) {
            showStatus('File size exceeds 30MB limit.', 'error');
            return;
        }

        const yearVal = document.getElementById('year').value;
        if (yearVal && !/^\d{4}$/.test(yearVal)) {
            showStatus('Year must be a 4-digit integer.', 'error');
            return;
        }

        const formData = new FormData(uploadForm);
        
        setLoading(true);
        showStatus('', ''); // clear

        try {
            const response = await fetchAuth('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (response.ok) {
                showStatus('File uploaded successfully!', 'success');
                uploadForm.reset();
                loadFiles(); // Refresh table and dashboard
            } else {
                showStatus(result.error || 'Upload failed.', 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            showStatus('An error occurred during upload.', 'error');
        } finally {
            setLoading(false);
        }
    });

    function setLoading(isLoading) {
        uploadBtn.disabled = isLoading;
        uploadLoader.style.display = isLoading ? 'block' : 'none';
    }

    function showStatus(message, type) {
        uploadStatus.textContent = message;
        uploadStatus.className = 'status-msg ' + type;
        setTimeout(() => { uploadStatus.textContent = ''; }, 5000);
    }

    // Load Files Data
    async function loadFiles() {
        try {
            const response = await fetchAuth('/api/files');
            allFiles = await response.json();
            allFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
            
            renderDashboard();
            applyCurrentFilter();
        } catch (error) {
            console.error('Error loading files:', error);
            filesBody.innerHTML = '<tr><td colspan="8" class="empty-state">Failed to load files.</td></tr>';
        }
    }

    // Render Dashboard Cards
    function renderDashboard() {
        dashboardGrid.innerHTML = '';
        
        if (!currentActiveFolder) {
            FOLDERS.forEach(folder => {
                const count = allFiles.filter(f => f.folder === folder.name).length;
                
                const card = document.createElement('div');
                card.className = `folder-card ${currentActiveFolder === folder.name ? 'active' : ''}`;
                
                card.innerHTML = `
                    <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="${folder.color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <div class="folder-title">${escapeHtml(folder.name)}</div>
                    <div class="folder-count">${count} file${count !== 1 ? 's' : ''}</div>
                `;
                
                card.addEventListener('click', () => {
                    visibleCount = 5;
                    currentActiveFolder = folder.name;
                    currentActiveSubfolder = null;
                    searchInput.value = '';
                    renderDashboard();
                    applyCurrentFilter();
                });
                
                dashboardGrid.appendChild(card);
            });
        } else {
            const folderFiles = allFiles.filter(f => f.folder === currentActiveFolder);
            const yearsSet = new Set(folderFiles.map(f => f.uploadDate ? new Date(f.uploadDate).getFullYear() : new Date().getFullYear()));
            if (yearsSet.size === 0) {
                yearsSet.add(new Date().getFullYear());
            }
            const years = Array.from(yearsSet).sort((a, b) => b - a);

            years.forEach(year => {
                const subfolderName = currentActiveFolder.replace(/\s+/g, '') + '_' + year;
                const count = folderFiles.filter(f => (f.uploadDate ? new Date(f.uploadDate).getFullYear() : new Date().getFullYear()) === year).length;

                const card = document.createElement('div');
                card.className = `subfolder-card ${currentActiveSubfolder === subfolderName ? 'active' : ''}`;

                card.innerHTML = `
                    <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <div class="folder-title">${escapeHtml(subfolderName)}</div>
                    <div class="folder-count">${count} file${count !== 1 ? 's' : ''}</div>
                `;

                card.addEventListener('click', () => {
                    visibleCount = 5;
                    currentActiveSubfolder = subfolderName;
                    renderDashboard();
                    applyCurrentFilter();
                });

                dashboardGrid.appendChild(card);
            });
        }
    }

    // Apply Filter based on Folder selection or Global Search
    function applyCurrentFilter() {
        const query = searchInput.value.toLowerCase().trim();
        
        let filteredFiles = allFiles;
        
        if (query) {
            currentActiveFolder = null; 
            currentActiveSubfolder = null;
            renderDashboard(); 
            
            tableTitle.textContent = `Search Results for "${query}"`;
            colFolder.classList.remove('hidden'); 
            dashboardGrid.classList.add('hidden');
            btnBack.classList.remove('hidden');
            btnBackupFolder.classList.add('hidden');
            
            filteredFiles = allFiles.filter(file => 
                (file.originalname && file.originalname.toLowerCase().includes(query)) ||
                (file.year && file.year.toString().includes(query)) ||
                (file.remarks && file.remarks.toLowerCase().includes(query)) ||
                (file.format && file.format.toLowerCase().includes(query)) ||
                (file.folder && file.folder.toLowerCase().includes(query))
            );
        } else if (currentActiveFolder) {
            if (currentActiveSubfolder) {
                tableTitle.textContent = `${currentActiveSubfolder}`;
                colFolder.classList.add('hidden'); 
                dashboardGrid.classList.add('hidden');
                btnBack.classList.remove('hidden');
                btnBack.innerHTML = `&larr; Back`;
                btnBackupFolder.classList.remove('hidden');
                
                const subYear = parseInt(currentActiveSubfolder.split('_')[1], 10);
                filteredFiles = allFiles.filter(f => f.folder === currentActiveFolder && (f.uploadDate ? new Date(f.uploadDate).getFullYear() : new Date().getFullYear()) === subYear);
            } else {
                tableTitle.textContent = `${currentActiveFolder}`;
                colFolder.classList.add('hidden'); 
                dashboardGrid.classList.remove('hidden');
                btnBack.classList.remove('hidden');
                btnBack.innerHTML = `&larr; Back`;
                btnBackupFolder.classList.add('hidden');
                
                filteredFiles = allFiles.filter(f => f.folder === currentActiveFolder);
            }
        } else {
            tableTitle.textContent = `All Files`;
            colFolder.classList.remove('hidden'); 
            dashboardGrid.classList.remove('hidden');
            btnBack.classList.add('hidden');
            btnBackupFolder.classList.add('hidden');
        }

        if (filteredFiles.length > visibleCount) {
            btnLoadMore.classList.remove('hidden');
            renderTable(filteredFiles.slice(0, visibleCount));
        } else {
            btnLoadMore.classList.add('hidden');
            renderTable(filteredFiles);
        }
    }

    searchInput.addEventListener('input', () => {
        visibleCount = 5;
        applyCurrentFilter();
    });

    function formatDateTime(isoString) {
        const date = new Date(isoString);
        return date.toLocaleString();
    }

    function renderTable(files) {
        filesBody.innerHTML = '';
        
        // Reset top-level buttons
        selectAll.checked = false;
        updateBulkButtons();
        if (currentRole === 'Viewer') {
            btnBulkEdit.classList.add('hidden');
        } else {
            btnBulkEdit.classList.remove('hidden');
        }
        btnBulkSave.classList.add('hidden');

        if (files.length === 0) {
            filesBody.innerHTML = `<tr><td colspan="${currentActiveFolder ? '5' : '6'}" class="empty-state">No files found.</td></tr>`;
            return;
        }

        files.forEach((file, index) => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-filename', file.filename);
            
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            
            // Build the folder dropdown for edit mode
            const folderSelectClone = folderDropdownTemplate.content.cloneNode(true);
            const folderSelectElement = folderSelectClone.querySelector('select');
            folderSelectElement.value = file.folder; // Set current folder

            // Direct URLs for standard anchor tags, passing token in URL query parameter if possible, 
            // but standard browser anchor tags use cookies or browser basic auth natively.
            // Since we suppressed native WWW-Authenticate, <a href> won't attach headers!
            // Wait: If the user needs to download via <a href>, we must append the token or use a fetch/blob download.
            // Actually, static downloads are protected by Basic Auth on the server. If the browser hasn't done Basic Auth natively, <a target="_blank"> will fail!
            // BUT wait! We haven't stripped the basicAuth from the static GET endpoints? 
            // Yes we did, but the browser won't send the Authorization header automatically for static links.
            // To fix this, we should use fetch() and create a blob URL for downloads, OR append ?token=xxx.
            // Given the limitations, creating a blob is safest.
            
            const viewUrl = `/api/view/${encodeURIComponent(file.filename)}?token=${encodeURIComponent(authHeader)}`;
            const downloadUrl = `/api/download/${encodeURIComponent(file.filename)}?token=${encodeURIComponent(authHeader)}`;

            tr.innerHTML = `
                <td><input type="checkbox" class="row-checkbox" value="${escapeHtml(file.filename)}"></td>
                <td>${index + 1}</td>
                <td>
                    <div class="file-name-container">
                        <div style="font-weight: 500; word-break: break-all;">${escapeHtml(file.originalname)}</div>
                        <div class="file-details">
                            <span>Uploaded by: <strong style="color: var(--primary-color);">${escapeHtml((file.uploader || 'Unknown').split('_')[0])}</strong></span>
                            <span>${sizeMB} MB</span>
                            <span class="format-badge">${escapeHtml(file.format)}</span>
                        </div>
                    </div>
                </td>
                <td class="cell-folder ${currentActiveFolder ? 'hidden' : ''}">
                    <span class="view-mode">${escapeHtml(file.folder)}</span>
                    <div class="edit-folder-wrapper"></div>
                </td>
                <td class="cell-remarks">
                    <span class="view-mode">${escapeHtml(file.remarks)}</span>
                    <input type="text" class="edit-input hidden edit-remarks" value="${escapeHtml(file.remarks)}">
                </td>
                <td>
                    <div class="actions-group">
                        <a href="${viewUrl}" target="_blank" class="action-btn btn-primary-outline" style="text-decoration: none;" title="View">View</a>
                        <a href="${downloadUrl}" download="${escapeHtml(file.originalname)}" class="action-btn btn-success-outline" style="display: flex; align-items: center; justify-content: center; text-decoration: none;" title="Download">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        </a>
                        <button class="action-btn btn-primary-outline btn-more" style="padding: 0.35rem 0.5rem;" title="More Details">More</button>
                    </div>
                </td>
            `;
            
            tr.querySelector('.edit-folder-wrapper').appendChild(folderSelectElement);
            
            const detailTr = document.createElement('tr');
            detailTr.className = 'detail-row hidden';
            detailTr.innerHTML = `
                <td colspan="${currentActiveFolder ? '5' : '6'}">
                    <div class="detail-panel">
                        <div class="detail-item">
                            <span class="detail-label">Upload Date</span>
                            <span class="detail-value">${formatDateTime(file.uploadDate)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Year</span>
                            <span class="detail-value view-mode">${escapeHtml(file.year || 'N/A')}</span>
                            <input type="text" class="edit-input hidden edit-year" value="${escapeHtml(file.year)}" maxlength="4" inputmode="numeric" pattern="[0-9]*" style="width: 100px; padding: 0.25rem;">
                        </div>
                    </div>
                </td>
            `;
            
            const btnMore = tr.querySelector('.btn-more');
            btnMore.addEventListener('click', (e) => {
                e.preventDefault();
                const isHidden = detailTr.classList.contains('hidden');
                if (isHidden) {
                    detailTr.classList.remove('hidden');
                    btnMore.textContent = 'Less';
                } else {
                    detailTr.classList.add('hidden');
                    btnMore.textContent = 'More';
                }
            });
            
            // Listen for checkbox changes
            const cb = tr.querySelector('.row-checkbox');
            cb.addEventListener('change', updateBulkButtons);
            
            filesBody.appendChild(tr);
            filesBody.appendChild(detailTr);
        });
    }

    function toggleEditMode(tr, isEditing) {
        const detailTr = tr.nextElementSibling;
        const viewModes = [...tr.querySelectorAll('.view-mode')];
        const editInputs = [...tr.querySelectorAll('.edit-input')];
        if (detailTr && detailTr.classList.contains('detail-row')) {
            viewModes.push(...detailTr.querySelectorAll('.view-mode'));
            editInputs.push(...detailTr.querySelectorAll('.edit-input'));
            if (isEditing) {
                detailTr.classList.remove('hidden');
                const moreBtn = tr.querySelector('.btn-more');
                if (moreBtn) moreBtn.textContent = 'Less';
            }
        }

        if (isEditing) {
            viewModes.forEach(el => el.classList.add('hidden'));
            editInputs.forEach(el => el.classList.remove('hidden'));
            const firstInput = detailTr ? detailTr.querySelector('.edit-year') : null;
            if (firstInput) firstInput.focus();
        } else {
            viewModes.forEach(el => el.classList.remove('hidden'));
            editInputs.forEach(el => el.classList.add('hidden'));
        }
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe
             .toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Start App
    checkAuth();
});
