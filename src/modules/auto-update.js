window.UpdateManager = window.UpdateManager || {};

(function() {
    var NS = window.UpdateManager;
    var container = null;
    var statusEl = null;
    var progressBar = null;
    var progressText = null;
    var actionBtn = null;
    var currentInfo = null;
    var lastStatus = null;
    var statusChangeCallbacks = [];

    NS.getLastStatus = function() { return lastStatus; };
    NS.getCurrentInfo = function() { return currentInfo; };
    NS.onStatusChange = function(cb) { statusChangeCallbacks.push(cb); };
    NS.removeStatusChange = function(cb) { statusChangeCallbacks = statusChangeCallbacks.filter(function(f) { return f !== cb; }); };

    NS.init = function() {
        _createUI();
        _listen();
        setTimeout(NS.check, 5000);
    };

    NS.check = function() {
        if (window.electronAPI && window.electronAPI.checkForUpdates) {
            lastStatus = { status: 'checking' };
            _notify();
            window.electronAPI.checkForUpdates();
        }
    };

    function _notify() {
        for (var i = 0; i < statusChangeCallbacks.length; i++) {
            try { statusChangeCallbacks[i](lastStatus); } catch(e) {}
        }
    }

    function _createUI() {
        if (document.getElementById('updater-container')) return;

        container = document.createElement('div');
        container.id = 'updater-container';

        var style = document.createElement('style');
        style.textContent = _getCSS();
        document.head.appendChild(style);

        container.innerHTML =
            '<div id="updater-panel">' +
                '<div id="updater-status"></div>' +
                '<div id="updater-progress-container" style="display:none">' +
                    '<div id="updater-progress-bar"><div id="updater-progress-fill"></div></div>' +
                    '<div id="updater-progress-text"></div>' +
                '</div>' +
                '<div id="updater-actions"></div>' +
            '</div>';

        document.body.appendChild(container);

        statusEl = container.querySelector('#updater-status');
        progressBar = container.querySelector('#updater-progress-container');
        progressText = container.querySelector('#updater-progress-text');
        actionBtn = container.querySelector('#updater-actions');
    }

    function _listen() {
        if (window.electronAPI && window.electronAPI.onUpdateStatus) {
            window.electronAPI.onUpdateStatus(function(data) {
                lastStatus = data;
                _notify();
                switch (data.status) {
                    case 'available':
                        currentInfo = data.info;
                        _showAvailable(data.info);
                        break;
                    case 'downloading':
                        _showProgress(data.progress);
                        break;
                    case 'downloaded':
                        _showDownloaded(data.info);
                        break;
                    case 'error':
                        _showError(data.error);
                        break;
                    case 'not-available':
                        _showNotAvailable();
                        break;
                    default:
                        break;
                }
            });
        }
    }

    function _showNotAvailable() {
        container.style.display = 'block';
        statusEl.innerHTML = 'Tienes la \u00faltima versi\u00f3n';
        statusEl.className = 'updater-not-available';
        progressBar.style.display = 'none';
        actionBtn.innerHTML = '<button id="updater-btn-close" class="updater-btn">Cerrar</button>';
        document.getElementById('updater-btn-close').onclick = function() { _hide(); };
        setTimeout(_hide, 6000);
    }

    function _showAvailable(info) {
        container.style.display = 'block';
        statusEl.innerHTML = 'Nueva versi\u00f3n <strong>' + (info.version || '') + '</strong> disponible';
        statusEl.className = 'updater-available';
        progressBar.style.display = 'none';
        actionBtn.innerHTML = '<button id="updater-btn-download" class="updater-btn updater-btn-primary">Descargar ahora</button>';
        document.getElementById('updater-btn-download').onclick = function() {
            if (window.electronAPI && window.electronAPI.downloadUpdate) {
                window.electronAPI.downloadUpdate();
                actionBtn.innerHTML = '<button class="updater-btn" disabled>Descargando...</button>';
            }
        };
    }

    function _showProgress(progress) {
        container.style.display = 'block';
        statusEl.innerHTML = 'Descargando actualizaci\u00f3n...';
        statusEl.className = 'updater-downloading';
        progressBar.style.display = 'block';
        var pct = progress.percent || 0;
        document.getElementById('updater-progress-fill').style.width = pct + '%';
        progressText.textContent = (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + '% - ' + _formatBytes(progress.transferred || 0) + ' / ' + _formatBytes(progress.total || 0);
        actionBtn.innerHTML = '';
    }

    function _showDownloaded(info) {
        container.style.display = 'block';
        statusEl.innerHTML = 'Actualizaci\u00f3n lista para instalar <strong>' + (info.version || '') + '</strong>';
        statusEl.className = 'updater-downloaded';
        progressBar.style.display = 'none';
        actionBtn.innerHTML = '<button id="updater-btn-install" class="updater-btn updater-btn-success">Instalar y reiniciar</button>';
        document.getElementById('updater-btn-install').onclick = function() {
            if (window.electronAPI && window.electronAPI.installUpdate) {
                window.electronAPI.installUpdate();
            }
        };
    }

    function _showError(err) {
        container.style.display = 'block';
        statusEl.innerHTML = 'Error: ' + (err || 'No se pudo conectar con GitHub');
        statusEl.className = 'updater-error';
        progressBar.style.display = 'none';
        actionBtn.innerHTML = '<button id="updater-btn-retry" class="updater-btn">Reintentar</button><button id="updater-btn-close" class="updater-btn" style="margin-left:8px">Cerrar</button>';
        document.getElementById('updater-btn-retry').onclick = function() { NS.check(); };
        document.getElementById('updater-btn-close').onclick = function() { _hide(); };
        console.error('[AutoUpdater] Error:', err);
    }

    function _hide() {
        container.style.display = 'none';
    }

    function _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function _getCSS() {
        return (
            '#updater-container {\n' +
            '    position: fixed;\n' +
            '    bottom: 20px;\n' +
            '    right: 20px;\n' +
            '    z-index: 9999;\n' +
            '    display: none;\n' +
            '    max-width: 380px;\n' +
            '}\n' +
            '#updater-panel {\n' +
            '    background: #1a1a2e;\n' +
            '    border: 1px solid #16213e;\n' +
            '    border-radius: 12px;\n' +
            '    padding: 16px 20px;\n' +
            '    box-shadow: 0 8px 32px rgba(0,0,0,0.4);\n' +
            '    color: #e0e0e0;\n' +
            '    font-family: sans-serif;\n' +
            '    font-size: 14px;\n' +
            '}\n' +
            '#updater-status { margin-bottom: 10px; }\n' +
            '#updater-status.updater-available { color: #4fc3f7; }\n' +
            '#updater-status.updater-downloading { color: #ffb74d; }\n' +
            '#updater-status.updater-downloaded { color: #81c784; }\n' +
            '#updater-status.updater-error { color: #e57373; }\n' +
            '#updater-status.updater-not-available { color: #81c784; }\n' +
            '#updater-progress-bar {\n' +
            '    height: 6px;\n' +
            '    background: #333;\n' +
            '    border-radius: 3px;\n' +
            '    margin-bottom: 6px;\n' +
            '    overflow: hidden;\n' +
            '}\n' +
            '#updater-progress-fill {\n' +
            '    height: 100%;\n' +
            '    background: linear-gradient(90deg, #4fc3f7, #81c784);\n' +
            '    border-radius: 3px;\n' +
            '    transition: width 0.3s;\n' +
            '}\n' +
            '#updater-progress-text { font-size: 12px; color: #aaa; text-align: center; }\n' +
            '#updater-actions { margin-top: 10px; text-align: center; }\n' +
            '.updater-btn {\n' +
            '    background: #333;\n' +
            '    color: #e0e0e0;\n' +
            '    border: 1px solid #555;\n' +
            '    border-radius: 6px;\n' +
            '    padding: 8px 20px;\n' +
            '    cursor: pointer;\n' +
            '    font-size: 14px;\n' +
            '    transition: all 0.2s;\n' +
            '}\n' +
            '.updater-btn-primary {\n' +
            '    background: #1976d2;\n' +
            '    border-color: #1976d2;\n' +
            '    color: #fff;\n' +
            '}\n' +
            '.updater-btn-primary:hover { background: #1565c0; }\n' +
            '.updater-btn-success {\n' +
            '    background: #388e3c;\n' +
            '    border-color: #388e3c;\n' +
            '    color: #fff;\n' +
            '}\n' +
            '.updater-btn-success:hover { background: #2e7d32; }\n' +
            '.updater-btn:disabled { opacity: 0.5; cursor: not-allowed; }\n'
        );
    }

})();
