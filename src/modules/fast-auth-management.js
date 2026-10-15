/**
 * fast-auth-management.js
 * Módulo de Autenticación Rápida, Selector de Cajeros por Tarjetas,
 * PIN-Pad Táctil y Creación Rápida de Usuarios y Sucursales para Caja Fresh POS.
 */

(function (window, document) {
    'use strict';

    const FastAuth = {
        selectedUser: null,
        pinBuffer: '',
        usersCache: [],
        storesCache: [],
        isInitialized: false,

        init() {
            if (this.isInitialized) return;
            this.isInitialized = true;

            // Escuchar atajos globales (F1 para bloqueo rápido de caja)
            document.addEventListener('keydown', (e) => {
                if (e.key === 'F1') {
                    e.preventDefault();
                    this.lockTerminal();
                } else if (this.isPinPadActive()) {
                    if (e.key >= '0' && e.key <= '9') {
                        e.preventDefault();
                        this.pressKey(e.key);
                    } else if (e.key === 'Backspace') {
                        e.preventDefault();
                        this.pressKey('backspace');
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        this.submitPin();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.backToUserSelector();
                    }
                }
            });

            // Cargar usuarios al inicio y cuando se abra el login
            this.loadUsersAndStores();

            // Interceptar apertura del panel de login para refrescar datos
            const originalOpen = window.openCashierLoginPanel;
            window.openCashierLoginPanel = () => {
                if (typeof originalOpen === 'function') originalOpen();
                this.onLoginOverlayOpened();
            };

            console.log('[FastAuth] 🚀 Módulo de Autenticación Rápida y Gestión de Personal inicializado.');
        },

        isPinPadActive() {
            const pinView = document.getElementById('login-pinpad-view');
            const overlay = document.getElementById('login-overlay');
            return overlay && !overlay.classList.contains('hidden') && pinView && !pinView.classList.contains('hidden');
        },

        async loadUsersAndStores() {
            try {
                if (window.db && typeof window.db.getUsers === 'function') {
                    const users = await window.db.getUsers();
                    this.usersCache = Array.isArray(users) ? users.filter(u => u.active !== 0) : [];
                }
            } catch (err) {
                console.warn('[FastAuth] Error cargando usuarios desde SQLite:', err);
            }

            try {
                if (window.db && typeof window.db.getStores === 'function') {
                    const stores = await window.db.getStores();
                    this.storesCache = Array.isArray(stores) ? stores : [];
                }
            } catch (err) {
                console.warn('[FastAuth] Error cargando sucursales:', err);
            }

            this.renderCashierCards();
            this.updateContextInfo();
        },

        onLoginOverlayOpened() {
            this.pinBuffer = '';
            this.selectedUser = null;
            this.loadUsersAndStores();
            this.switchToSelectorView();
        },

        updateContextInfo() {
            // Actualizar Tasa BCV y estado local en el login
            const bcvBadge = document.getElementById('login-bcv-rate-badge');
            if (bcvBadge) {
                const rate = (window.settings && window.settings.dollarRate) || (window.currentDollarRate) || null;
                if (rate) {
                    bcvBadge.textContent = `Tasa BCV: ${parseFloat(rate).toFixed(2)} Bs/$`;
                    bcvBadge.classList.remove('hidden');
                } else {
                    bcvBadge.classList.add('hidden');
                }
            }
        },

        renderCashierCards() {
            const grid = document.getElementById('login-users-grid');
            if (!grid) return;

            let users = this.usersCache;
            if (!users || users.length === 0) {
                // Fallbacks amigables en caso de DB vacía
                users = [
                    { id: 'usr_admin', username: 'admin', name: 'Administrador', role: 'admin' },
                    { id: 'usr_cajero', username: 'cajero', name: 'Cajero Principal', role: 'cashier' }
                ];
            }

            grid.innerHTML = '';

            users.forEach(user => {
                const isAdmin = user.role === 'admin' || user.role === 'boss';
                const displayName = user.name || user.username || 'Usuario';
                const roleLabel = user.role === 'boss' ? 'Jefe / Dueño' : (isAdmin ? 'Administrador' : 'Cajero');
                
                // Iniciales para el avatar
                const initials = displayName
                    .split(' ')
                    .map(n => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();

                const card = document.createElement('div');
                card.className = `group relative p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex items-center gap-3 select-none active:scale-[0.98] ${
                    isAdmin 
                        ? 'bg-slate-900/80 border-slate-800 hover:border-blue-500/50 hover:bg-slate-900 shadow-sm hover:shadow-blue-500/10' 
                        : 'bg-slate-900/80 border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900 shadow-sm hover:shadow-emerald-500/10'
                }`;

                card.onclick = () => this.selectUser(user);

                card.innerHTML = `
                    <div class="w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm tracking-tight text-white shadow-md ${
                        isAdmin 
                            ? 'bg-gradient-to-br from-blue-600 to-indigo-700 border border-blue-400/30' 
                            : 'bg-gradient-to-br from-emerald-600 to-teal-700 border border-emerald-400/30'
                    }">
                        ${initials || (isAdmin ? '<i class="fas fa-crown text-xs"></i>' : '<i class="fas fa-user text-xs"></i>')}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-bold text-white truncate group-hover:text-blue-300 transition-colors">
                            ${displayName}
                        </div>
                        <div class="text-[11px] font-medium flex items-center gap-1.5 ${isAdmin ? 'text-blue-400' : 'text-emerald-400'}">
                            <i class="${isAdmin ? 'fas fa-shield-alt text-[9px]' : 'fas fa-cash-register text-[9px]'}"></i>
                            <span>${roleLabel}</span>
                        </div>
                    </div>
                    <div class="w-6 h-6 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 group-hover:text-white group-hover:bg-blue-600 transition-all text-xs">
                        <i class="fas fa-chevron-right text-[10px]"></i>
                    </div>
                `;

                grid.appendChild(card);
            });
        },

        selectUser(user) {
            this.selectedUser = user;
            this.pinBuffer = '';

            const selView = document.getElementById('login-cashier-selector-view');
            const pinView = document.getElementById('login-pinpad-view');
            const manView = document.getElementById('login-manual-view');

            if (selView) selView.classList.add('hidden');
            if (manView) manView.classList.add('hidden');
            if (pinView) {
                pinView.classList.remove('hidden');
                pinView.classList.add('fade-in');
            }

            // Actualizar datos del usuario en la vista de PIN
            const nameEl = document.getElementById('pinpad-user-name');
            const roleEl = document.getElementById('pinpad-user-role');
            const avatarEl = document.getElementById('pinpad-user-avatar');

            const displayName = user.name || user.username || 'Usuario';
            const isAdmin = user.role === 'admin' || user.role === 'boss';

            if (nameEl) nameEl.textContent = displayName;
            if (roleEl) {
                roleEl.textContent = user.role === 'boss' ? '👑 Jefe / Dueño' : (isAdmin ? '🛡️ Administrador' : '👤 Cajero');
                roleEl.className = `text-xs font-semibold ${isAdmin ? 'text-blue-400' : 'text-emerald-400'}`;
            }
            if (avatarEl) {
                avatarEl.textContent = displayName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                avatarEl.className = `w-14 h-14 rounded-2xl flex items-center justify-center font-black text-lg text-white shadow-lg mx-auto ${
                    isAdmin ? 'bg-gradient-to-br from-blue-600 to-indigo-700' : 'bg-gradient-to-br from-emerald-600 to-teal-700'
                }`;
            }

            this.updatePinDots();
            this.clearPinError();
        },

        backToUserSelector() {
            this.selectedUser = null;
            this.pinBuffer = '';
            this.switchToSelectorView();
        },

        switchToSelectorView() {
            const selView = document.getElementById('login-cashier-selector-view');
            const pinView = document.getElementById('login-pinpad-view');
            const manView = document.getElementById('login-manual-view');

            if (pinView) pinView.classList.add('hidden');
            if (manView) manView.classList.add('hidden');
            if (selView) {
                selView.classList.remove('hidden');
                selView.classList.add('fade-in');
            }
        },

        switchToManualView() {
            const selView = document.getElementById('login-cashier-selector-view');
            const pinView = document.getElementById('login-pinpad-view');
            const manView = document.getElementById('login-manual-view');

            if (selView) selView.classList.add('hidden');
            if (pinView) pinView.classList.add('hidden');
            if (manView) {
                manView.classList.remove('hidden');
                manView.classList.add('fade-in');
                const userInp = document.getElementById('login-username');
                if (userInp) setTimeout(() => userInp.focus(), 150);
            }
        },

        pressKey(key) {
            if (!this.selectedUser) return;
            this.clearPinError();

            if (key === 'C' || key === 'clear') {
                this.pinBuffer = '';
            } else if (key === 'backspace' || key === '⌫') {
                if (this.pinBuffer.length > 0) {
                    this.pinBuffer = this.pinBuffer.slice(0, -1);
                }
            } else if (typeof key === 'string' && key.length === 1 && key >= '0' && key <= '9') {
                if (this.pinBuffer.length < 8) {
                    this.pinBuffer += key;
                }
            }

            this.updatePinDots();

            // Si completa 4 o más dígitos, podemos dar feedback sonoro/visual
            if (this.pinBuffer.length === 4) {
                // Auto-intento opcional si es un PIN estándar de 4 dígitos
                setTimeout(() => {
                    if (this.pinBuffer.length === 4) {
                        this.submitPin();
                    }
                }, 150);
            }
        },

        updatePinDots() {
            const dots = document.querySelectorAll('.pin-indicator-dot');
            const len = this.pinBuffer.length;
            dots.forEach((dot, idx) => {
                if (idx < len) {
                    dot.className = 'pin-indicator-dot w-4 h-4 rounded-full bg-blue-500 shadow-md shadow-blue-500/50 scale-110 transition-all duration-150';
                } else {
                    dot.className = 'pin-indicator-dot w-4 h-4 rounded-full bg-slate-800 border border-slate-700 transition-all duration-150';
                }
            });
        },

        showPinError(msg) {
            const errEl = document.getElementById('pinpad-error');
            if (errEl) {
                errEl.textContent = msg;
                errEl.classList.remove('hidden');
            }
            // Animación de shake en los dots
            const dotsContainer = document.getElementById('pin-dots-container');
            if (dotsContainer) {
                dotsContainer.classList.add('animate-shake');
                setTimeout(() => dotsContainer.classList.remove('animate-shake'), 500);
            }
            this.pinBuffer = '';
            setTimeout(() => this.updatePinDots(), 400);
        },

        clearPinError() {
            const errEl = document.getElementById('pinpad-error');
            if (errEl) {
                errEl.textContent = '';
                errEl.classList.add('hidden');
            }
        },

        async submitPin() {
            if (!this.selectedUser) return;
            if (!this.pinBuffer) {
                this.showPinError('Por favor ingresa tu PIN');
                return;
            }

            const username = this.selectedUser.username;
            const pin = this.pinBuffer;

            // Invocar el método central de autenticación
            if (typeof window.loginUser === 'function') {
                const res = await window.loginUser(username, pin);
                if (res && res.ok) {
                    // Éxito: cerrar overlay y verificar apertura de fondo de caja
                    this.onLoginSuccess(res.user);
                } else {
                    this.showPinError((res && res.error) || 'PIN incorrecto. Intenta de nuevo.');
                }
            } else {
                this.showPinError('Sistema de login no disponible');
            }
        },

        async onLoginSuccess(user) {
            console.log('[FastAuth] ✅ Login exitoso:', user.username, user.role);
            this.pinBuffer = '';
            this.selectedUser = null;

            // Desplegar modal de Apertura de Fondo de Caja si no se ha abierto hoy
            setTimeout(() => {
                this.checkOpeningCashFloat();
            }, 600);
        },

        lockTerminal() {
            if (typeof window.logoutUser === 'function') {
                window.logoutUser();
            }
            const overlay = document.getElementById('login-overlay');
            if (overlay) overlay.classList.remove('hidden');
            this.onLoginOverlayOpened();
        },

        // --- APERTURA DE FONDO DE CAJA AL INICIAR TURNO ---
        async checkOpeningCashFloat() {
            try {
                const today = new Date().toISOString().split('T')[0];
                const storeId = (window._getStoreId && window._getStoreId()) || '';
                
                let cashup = null;
                if (window.db && typeof window.db.getCashupByDate === 'function') {
                    cashup = await window.db.getCashupByDate(storeId, today);
                }

                // Si ya hay un cashup abierto o cerrado hoy, no molestar
                if (cashup && (cashup.opening_usd !== undefined || cashup.opening_ves !== undefined)) {
                    return;
                }

                if (!window.Swal) return;

                const { value: formValues } = await window.Swal.fire({
                    title: '💵 Apertura de Turno de Caja',
                    html: `
                        <p class="text-xs text-slate-500 mb-4">Declara el fondo inicial de efectivo con el que arrancas en caja:</p>
                        <div class="space-y-3 text-left">
                            <div>
                                <label class="text-xs font-bold text-slate-700 block mb-1">Fondo en Efectivo USD ($)</label>
                                <input id="swal-opening-usd" type="number" step="0.5" class="w-full px-3 py-2 border rounded-lg text-sm font-bold text-slate-800" placeholder="0.00" value="0">
                            </div>
                            <div>
                                <label class="text-xs font-bold text-slate-700 block mb-1">Fondo en Efectivo VES (Bs)</label>
                                <input id="swal-opening-ves" type="number" step="1" class="w-full px-3 py-2 border rounded-lg text-sm font-bold text-slate-800" placeholder="0.00" value="0">
                            </div>
                        </div>
                    `,
                    focusConfirm: false,
                    showCancelButton: true,
                    cancelButtonText: 'Omitir por ahora',
                    confirmButtonText: 'Registrar Apertura ➔',
                    confirmButtonColor: '#2563eb',
                    preConfirm: () => {
                        const usd = parseFloat(document.getElementById('swal-opening-usd').value) || 0;
                        const ves = parseFloat(document.getElementById('swal-opening-ves').value) || 0;
                        return { usd, ves };
                    }
                });

                if (formValues && window.db && typeof window.db.saveCashup === 'function') {
                    const cashupData = {
                        id: 'cashup_' + today + '_' + Date.now(),
                        date: today,
                        opening_usd: formValues.usd,
                        opening_ves: formValues.ves,
                        status: 'open',
                        store_id: storeId
                    };
                    await window.db.saveCashup(storeId, cashupData);
                    window.Swal.fire({
                        icon: 'success',
                        title: 'Apertura Registrada',
                        text: `Fondo registrado: $${formValues.usd.toFixed(2)} USD / ${formValues.ves.toFixed(2)} Bs`,
                        timer: 2000,
                        showConfirmButton: false
                    });
                }
            } catch (err) {
                console.warn('[FastAuth] Error al registrar fondo de caja:', err);
            }
        },

        // --- CREACIÓN RÁPIDA DE USUARIOS (CAJEROS / ADMINS / JEFES) ---
        async openCreateUserModal() {
            if (!window.Swal) return;

            // 1. Validar autorización si no hay usuario admin activo
            const currentRole = window.currentRole || (window.currentUser && window.currentUser.role);
            if (currentRole !== 'admin' && currentRole !== 'boss') {
                const { value: authPin } = await window.Swal.fire({
                    title: '🔒 Autorización Requerida',
                    text: 'Ingresa el PIN de Administrador o Jefe para agregar personal:',
                    input: 'password',
                    inputPlaceholder: 'PIN Maestro o de Administrador',
                    showCancelButton: true,
                    cancelButtonText: 'Cancelar',
                    confirmButtonText: 'Verificar',
                    confirmButtonColor: '#2563eb'
                });

                if (!authPin) return;

                // Validar contra PIN maestro o admin
                const isMaster = (authPin === '2008+' || authPin === '32447974');
                let isDbAdmin = false;
                if (!isMaster && window.db && typeof window.db.getUser === 'function') {
                    const adminUser = await window.db.getUser('admin');
                    if (adminUser && typeof window.hashPassword === 'function') {
                        const h = await window.hashPassword(authPin, adminUser.salt);
                        if (h === adminUser.password_hash) isDbAdmin = true;
                    }
                }

                if (!isMaster && !isDbAdmin) {
                    window.Swal.fire({ icon: 'error', title: 'PIN Inválido', text: 'No tienes autorización para crear personal.' });
                    return;
                }
            }

            // Opciones de sucursales
            let storeOptionsHtml = '<option value="">Sucursal Principal</option>';
            if (this.storesCache && this.storesCache.length > 0) {
                storeOptionsHtml = this.storesCache
                    .map(s => `<option value="${s.id}">${s.name || s.id}</option>`)
                    .join('');
            }

            // 2. Desplegar formulario visual
            const { value: formValues } = await window.Swal.fire({
                title: '👤 Nuevo Integrante del Equipo',
                html: `
                    <div class="space-y-3.5 text-left text-slate-700">
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Nombre Completo *</label>
                            <input id="fast-user-name" type="text" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ej: Carlos Mendoza">
                        </div>
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Usuario / Alias *</label>
                            <input id="fast-user-username" type="text" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ej: carlos">
                        </div>
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Rol del Usuario *</label>
                            <select id="fast-user-role" class="w-full px-3 py-2 border rounded-lg text-sm bg-white font-medium">
                                <option value="cashier" selected>👤 Cajero / Vendedor (Solo cobra y arquea)</option>
                                <option value="admin">🛡️ Administrador (Gestión de tienda e inventario)</option>
                                <option value="boss">👑 Jefe / Dueño (Acceso total)</option>
                            </select>
                        </div>
                        <div>
                            <div class="flex items-center justify-between mb-1">
                                <label class="text-xs font-bold text-slate-800">PIN de Acceso (4 a 6 dígitos) *</label>
                                <button type="button" onclick="document.getElementById('fast-user-pin').value = Math.floor(1000 + Math.random() * 9000);" class="text-[11px] text-blue-600 font-bold hover:underline cursor-pointer">
                                    🎲 Generar PIN
                                </button>
                            </div>
                            <input id="fast-user-pin" type="text" maxlength="6" class="w-full px-3 py-2 border rounded-lg text-sm font-mono tracking-widest text-center font-bold" placeholder="Ej: 1234">
                        </div>
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Sucursal Asignada</label>
                            <select id="fast-user-store" class="w-full px-3 py-2 border rounded-lg text-sm bg-white font-medium">
                                ${storeOptionsHtml}
                            </select>
                        </div>
                    </div>
                `,
                didOpen: () => {
                    const nameInp = document.getElementById('fast-user-name');
                    const userInp = document.getElementById('fast-user-username');
                    if (nameInp && userInp) {
                        nameInp.addEventListener('input', () => {
                            if (!userInp.dataset.manual) {
                                userInp.value = nameInp.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
                            }
                        });
                        userInp.addEventListener('input', () => { userInp.dataset.manual = 'true'; });
                    }
                },
                focusConfirm: false,
                showCancelButton: true,
                cancelButtonText: 'Cancelar',
                confirmButtonText: 'Guardar y Habilitar en Caja ➔',
                confirmButtonColor: '#10b981',
                preConfirm: () => {
                    const name = document.getElementById('fast-user-name').value.trim();
                    const username = document.getElementById('fast-user-username').value.trim().toLowerCase();
                    const role = document.getElementById('fast-user-role').value;
                    const pin = document.getElementById('fast-user-pin').value.trim();
                    const storeId = document.getElementById('fast-user-store').value;

                    if (!name) { window.Swal.showValidationMessage('Ingresa el nombre completo'); return false; }
                    if (!username) { window.Swal.showValidationMessage('Ingresa un usuario o alias'); return false; }
                    if (!pin || pin.length < 4) { window.Swal.showValidationMessage('El PIN debe tener al menos 4 dígitos numéricos'); return false; }

                    return { name, username, role, pin, storeId };
                }
            });

            if (formValues) {
                try {
                    window.Swal.fire({ title: 'Guardando...', text: 'Registrando usuario en SQLite', allowOutsideClick: false, didOpen: () => window.Swal.showLoading() });

                    // Encriptar PIN con PBKDF2
                    let salt = 'salt_' + Date.now();
                    let hash = formValues.pin;

                    if (typeof window.generateSalt === 'function' && typeof window.hashPassword === 'function') {
                        salt = window.generateSalt();
                        hash = await window.hashPassword(formValues.pin, salt);
                    }

                    const newUser = {
                        id: 'usr_' + formValues.username + '_' + Date.now().toString().slice(-4),
                        store_id: formValues.storeId || '',
                        username: formValues.username,
                        password_hash: hash,
                        salt: salt,
                        role: formValues.role,
                        name: formValues.name,
                        active: 1,
                        created_at: new Date().toISOString()
                    };

                    if (window.db && typeof window.db.saveUser === 'function') {
                        await window.db.saveUser(newUser);
                    }

                    // Recargar caché y pintar tarjetas de inmediato
                    await this.loadUsersAndStores();

                    window.Swal.fire({
                        icon: 'success',
                        title: '¡Usuario Creado!',
                        html: `
                            <p class="text-sm text-slate-600 mb-2"><b>${formValues.name}</b> ya está habilitado en caja.</p>
                            <div class="bg-slate-100 p-2.5 rounded-lg text-xs font-mono font-bold text-slate-800">
                                Usuario: <span class="text-blue-600">${formValues.username}</span> | PIN: <span class="text-emerald-600">${formValues.pin}</span>
                            </div>
                        `,
                        confirmButtonColor: '#2563eb'
                    });
                } catch (e) {
                    console.error('[FastAuth] Error guardando usuario:', e);
                    window.Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar el usuario: ' + e.message });
                }
            }
        },

        // --- CREACIÓN RÁPIDA DE SUCURSALES Y ALMACENES ---
        async openCreateStoreModal() {
            if (!window.Swal) return;

            const { value: formValues } = await window.Swal.fire({
                title: '🏪 Nueva Sucursal o Almacén',
                html: `
                    <div class="space-y-3.5 text-left text-slate-700">
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Nombre de la Sucursal *</label>
                            <input id="fast-store-name" type="text" class="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ej: Sucursal Centro o Almacén 1">
                        </div>
                        <div>
                            <label class="text-xs font-bold block mb-1 text-slate-800">Tipo de Instalación *</label>
                            <select id="fast-store-type" class="w-full px-3 py-2 border rounded-lg text-sm bg-white font-medium">
                                <option value="kiosko" selected>🏪 Kiosko / Tienda de Venta al Público</option>
                                <option value="warehouse">📦 Almacén Central / Depósito de Mercancía</option>
                            </select>
                        </div>
                    </div>
                `,
                focusConfirm: false,
                showCancelButton: true,
                cancelButtonText: 'Cancelar',
                confirmButtonText: 'Crear Sucursal ➔',
                confirmButtonColor: '#2563eb',
                preConfirm: () => {
                    const name = document.getElementById('fast-store-name').value.trim();
                    const type = document.getElementById('fast-store-type').value;
                    if (!name) { window.Swal.showValidationMessage('Ingresa el nombre de la sucursal'); return false; }
                    return { name, type };
                }
            });

            if (formValues) {
                try {
                    const storeId = 'store_' + formValues.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString().slice(-4);
                    const newStore = {
                        id: storeId,
                        name: formValues.name,
                        brand_name: (window.settings && window.settings.businessName) || 'Punto Pila POS',
                        store_type: formValues.type,
                        status: 'online',
                        created_at: new Date().toISOString()
                    };

                    if (window.db && typeof window.db.saveStore === 'function') {
                        await window.db.saveStore(newStore);
                    }

                    await this.loadUsersAndStores();

                    window.Swal.fire({
                        icon: 'success',
                        title: '¡Sucursal Creada!',
                        text: `Se ha registrado "${formValues.name}" con éxito.`,
                        timer: 2000,
                        showConfirmButton: false
                    });
                } catch (e) {
                    console.error('[FastAuth] Error guardando sucursal:', e);
                    window.Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo guardar la sucursal: ' + e.message });
                }
            }
        }
    };

    // Exponer en window
    window.FastAuth = FastAuth;

    // Inicializar al cargar el DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => FastAuth.init());
    } else {
        FastAuth.init();
    }

})(window, document);
