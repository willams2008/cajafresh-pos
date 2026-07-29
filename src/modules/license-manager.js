window.LicenseManager = {
    STORAGE_KEY: 'freshpos_license',

    _getLocal() {
        try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}'); } catch (e) { return {}; }
    },

    _saveLocal(data) {
        const existing = this._getLocal();
        const merged = { ...existing, ...data };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(merged));
        return merged;
    },

    generateMachineId() {
        const stored = this._getLocal();
        if (stored.machine_id) return stored.machine_id;
        var screenInfo = 'unknown';
        try { screenInfo = `${screen.width}x${screen.height}x${screen.colorDepth}`; } catch(e) { screenInfo = 'unknown'; }
        const cores = navigator.hardwareConcurrency || '?';
        const lang = navigator.language || 'unknown';
        const raw = `${cores}_${screenInfo}_${lang}_${navigator.platform || ''}_${Date.now()}`;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            const chr = raw.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        const machineId = 'mf_' + Math.abs(hash).toString(36) + '_' + Math.random().toString(36).substr(2, 6);
        this._saveLocal({ machine_id: machineId });
        return machineId;
    },

    generateAppId() {
        const stored = this._getLocal();
        if (stored.app_id) return stored.app_id;
        const appId = 'app_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        this._saveLocal({ app_id: appId });
        return appId;
    },

    getDeviceName() {
        return this._getLocal().device_name || '';
    },

    setDeviceName(name) {
        this._saveLocal({ device_name: name });
    },

    getLocalStatus() {
        return this._getLocal();
    },

    // Mark that this machine has a valid membership code
    setCodeValidated(code, data) {
        this._saveLocal({
            code_validated: true,
            membership_code: code,
            membership_data: data || {},
            code_validated_at: Date.now()
        });
    },

    isCodeValidated() {
        const local = this._getLocal();
        return !!(local.code_validated && local.membership_code);
    },

    getMembershipCode() {
        return this._getLocal().membership_code || '';
    },

    // Check if local cache is expired (3 days without heartbeat)
    isCacheExpired() {
        const local = this._getLocal();
        if (!local.last_check) return true;
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        return (Date.now() - local.last_check) > threeDays;
    },

    async checkAndRegister(opts) {
        const machineId = opts.machineId || this.generateMachineId();
        const appId = opts.appId || this.generateAppId();
        let local = this._getLocal();

        if (!local.registered) {
            if (window.cloudSync && window.cloudSync.registerMachine) {
                const result = await window.cloudSync.registerMachine(
                    machineId,
                    appId,
                    opts.deviceName || local.device_name || 'PC Principal',
                    opts.userType || 'negocio',
                    opts.userInfo || {}
                );
                if (result.ok) {
                    this._saveLocal({
                        registered: true,
                        trial_end: result.trial_end,
                        last_check: Date.now()
                    });
                    local = this._getLocal();
                } else {
                    console.warn('[LICENSE-MANAGER] Register failed:', result.error);
                }
            }
        }
        return { machine_id: machineId, app_id: appId, local };
    },

    async checkLicense(machineId) {
        const local = this._getLocal();

        if (window.cloudSync && window.cloudSync.checkLicense) {
            try {
                const result = await window.cloudSync.checkLicense(machineId);
                this._saveLocal({ last_check: Date.now() });

                if (result.status === 'active') return { allowed: true, status: 'active', remote: true };
                if (result.status === 'trial') {
                    const daysLeft = Math.max(0, Math.ceil((new Date(result.trial_end) - new Date()) / 86400000));
                    return { allowed: true, status: 'trial', remote: true, daysLeft, trial_end: result.trial_end };
                }
                if (result.status === 'trial_expired') {
                    return { allowed: false, status: 'trial_expired', remote: true };
                }
                if (result.status === 'deactivated') {
                    return { allowed: false, status: 'deactivated', remote: true, reason: result.deactivation_reason || '' };
                }
                if (result.status === 'not_found') {
                    return { allowed: false, status: 'not_found', remote: true };
                }
                return { allowed: true, status: result.status || 'unknown', remote: true };
            } catch (e) {
                console.warn('[LICENSE-MANAGER] Remote check failed:', e.message);
                if (this.isCacheExpired()) {
                    return { allowed: false, status: 'offline_expired', remote: false };
                }
            }
        }

        // Offline fallback with expiry check
        if (this.isCacheExpired() && !local.code_validated) {
            return { allowed: false, status: 'offline_expired', remote: false };
        }

        return { allowed: true, status: 'offline_cached', remote: false };
    },

    async heartbeat(machineId) {
        if (window.cloudSync && window.cloudSync.licenseHeartbeat) {
            try {
                await window.cloudSync.licenseHeartbeat(machineId, '');
            } catch (e) {}
        }
    },

    async getAllLicenses() {
        if (window.cloudSync && window.cloudSync.getAllLicenses) {
            try { return await window.cloudSync.getAllLicenses(); } catch (e) { return []; }
        }
        return [];
    },

    async updateLicense(machineId, status, reason) {
        if (window.cloudSync && window.cloudSync.updateLicense) {
            try { return await window.cloudSync.updateLicense(machineId, status, reason); } catch (e) { return { ok: false, error: e.message }; }
        }
        return { ok: false, error: 'No cloudSync' };
    },

    updateSidebarIndicator(status) {
        const el = document.getElementById('license-status-indicator');
        const icon = document.getElementById('license-status-icon');
        const text = document.getElementById('license-status-text');
        const sub = document.getElementById('license-status-sub');
        if (!el || !icon || !text) return;
        el.classList.remove('hidden');
        const map = {
            active: { icon: 'text-emerald-500', label: 'Activa', sub: '✓' },
            trial: { icon: 'text-amber-500', label: 'Prueba', sub: '' },
            deactivated: { icon: 'text-red-500', label: 'Bloqueada', sub: '⛔' },
            trial_expired: { icon: 'text-red-500', label: 'Expirada', sub: '⛔' },
            offline_expired: { icon: 'text-red-500', label: 'Sin conexión', sub: '⚠' },
            offline_cached: { icon: 'text-slate-400', label: 'Offline', sub: '☁' },
            pending: { icon: 'text-blue-500', label: 'Pendiente', sub: '⏳' },
            not_found: { icon: 'text-slate-400', label: 'Sin registrar', sub: '—' }
        };
        const s = map[status] || { icon: 'text-slate-400', label: status, sub: '?' };
        icon.className = 'fas fa-circle text-[8px] ' + s.icon;
        text.textContent = s.label;
        if (sub) sub.textContent = s.sub;
    },

    renderLicenseAdmin(container) {
        var self = this;
        container.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div></div>';
        this.getAllLicenses().then(function(licenses) {
            if (!licenses || licenses.length === 0) {
                container.innerHTML = '<div class="text-center py-12 text-slate-500"><i class="fas fa-server text-4xl mb-4 opacity-30"></i><p>No hay máquinas registradas aún.</p><p class="text-xs mt-2">Cuando una PC nueva inicie el POS aparecerá aquí.</p></div>';
                return;
            }
            var statusBadge = function(s) {
                var map = { active: 'bg-emerald-100 text-emerald-800', trial: 'bg-amber-100 text-amber-800', pending: 'bg-blue-100 text-blue-800', deactivated: 'bg-red-100 text-red-800', trial_expired: 'bg-slate-200 text-slate-600' };
                return '<span class="px-2 py-0.5 rounded-full text-xs font-bold ' + (map[s] || 'bg-slate-100 text-slate-600') + '">' + s + '</span>';
            };
            var html = '<div class="flex items-center justify-between mb-4"><h4 class="font-bold text-sm text-slate-800">📋 Máquinas (' + licenses.length + ')</h4></div><div class="space-y-3 max-h-[400px] overflow-y-auto">';
            licenses.forEach(function(l) {
                var lastSeen = l.last_seen ? new Date(l.last_seen).toLocaleString() : '—';
                html += '<div class="bg-slate-50 rounded-xl p-4 border border-slate-200"><div class="flex items-start justify-between mb-2"><div><div class="flex items-center gap-2"><i class="fas fa-laptop text-slate-400"></i><span class="font-bold text-sm text-slate-800">' + (l.device_name || 'PC sin nombre') + '</span>' + statusBadge(l.status) + '</div><div class="text-[10px] text-slate-500 mt-1 font-mono">ID: ' + (l.machine_id ? l.machine_id.substring(0, 16) + '...' : '—') + ' | Código: ' + (l.membership_code || '—') + '</div></div></div>';
                html += '<div class="grid grid-cols-2 gap-2 text-xs text-slate-600"><div><span class="text-slate-400">Tipo:</span> ' + (l.user_type || '—') + '</div><div><span class="text-slate-400">Última vez:</span> ' + lastSeen + '</div></div>';
                if (l.deactivation_reason) html += '<div class="text-[10px] text-red-400 mt-1">Razón: ' + l.deactivation_reason + '</div>';
                var isCurrent = l.machine_id === self._getLocal().machine_id;
                html += '<div class="flex gap-2 mt-2 pt-2 border-t border-slate-200">';
                if (l.status !== 'active') html += '<button onclick="window.LicenseManager._toggle(\'' + l.machine_id + '\',\'active\',\'\')" class="px-3 py-1 text-xs font-bold rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all" ' + (isCurrent ? 'disabled' : '') + '><i class="fas fa-check mr-1"></i>Activar</button>';
                if (l.status !== 'deactivated') html += '<button onclick="window.LicenseManager._promptDeactivate(\'' + l.machine_id + '\')" class="px-3 py-1 text-xs font-bold rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all" ' + (isCurrent ? 'disabled' : '') + '><i class="fas fa-ban mr-1"></i>Desactivar</button>';
                if (isCurrent) html += '<span class="text-[10px] text-slate-400 italic">(este equipo)</span>';
                html += '</div></div>';
            });
            html += '</div>';
            container.innerHTML = html;
        }).catch(function(e) {
            container.innerHTML = '<div class="text-center py-8 text-red-500"><i class="fas fa-exclamation-triangle text-2xl mb-2"></i><p>Error: ' + e.message + '</p></div>';
        });
    },

    showBlockOverlay(status, reason) {
        const overlay = document.getElementById('block-overlay');
        const title = document.getElementById('block-title');
        const msg = document.getElementById('block-message');
        const mid = document.getElementById('block-machine-id');
        if (!overlay) return;
        if (status === 'deactivated') {
            title.textContent = '⛔ EQUIPO DESACTIVADO';
            msg.textContent = reason ? 'Motivo: ' + reason : 'Esta PC fue desactivada por el administrador.';
        } else if (status === 'trial_expired') {
            title.textContent = '⏳ PERÍODO DE PRUEBA EXPIRADO';
            msg.textContent = 'Los 7 días de prueba terminaron. Solicita activación a tu proveedor.';
        } else if (status === 'offline_expired') {
            title.textContent = '🌐 SIN CONEXIÓN';
            msg.textContent = 'Han pasado más de 3 días sin conexión. Conecta a internet para verificar la licencia.';
        } else {
            title.textContent = '🚫 SISTEMA BLOQUEADO';
            msg.textContent = 'Esta PC no está autorizada. Contacta al administrador.';
        }
        mid.textContent = this._getLocal().machine_id || '—';
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
        // Update sidebar
        this.updateSidebarIndicator(status);
    },

    async _toggle(machineId, status, reason) {
        const result = await this.updateLicense(machineId, status, reason);
        if (result.ok) {
            Swal.fire({ title: status === 'active' ? '✅ Activada' : '⛔ Desactivada', text: 'Máquina ' + machineId.substring(0, 8) + '... ' + (status === 'active' ? 'activada' : 'desactivada') + ' correctamente.', icon: 'success', timer: 2000, showConfirmButton: false });
            const adminEl = document.getElementById('admin-features-list');
            if (adminEl) this.renderLicenseAdmin(adminEl);
        } else {
            Swal.fire('Error', result.error || 'No se pudo actualizar', 'error');
        }
    },

    _promptDeactivate(machineId) {
        Swal.fire({
            title: 'Desactivar Máquina',
            input: 'text',
            inputLabel: 'Motivo (opcional)',
            inputPlaceholder: 'Ej: PC robada, reemplazada...',
            showCancelButton: true,
            confirmButtonText: 'Desactivar',
            confirmButtonColor: '#ef4444',
            cancelButtonText: 'Cancelar'
        }).then(function(r) {
            if (r.isConfirmed) window.LicenseManager._toggle(machineId, 'deactivated', r.value || '');
        });
    }
};

window.LicenseManager.generateMachineId();
window.LicenseManager.generateAppId();
