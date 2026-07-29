/**
 * Calculadora — Widget de calculadora para el POS
 *
 * Herramienta aritmética auxiliar para el cajero.
 * Se inyecta en el contenedor especificado (por defecto #view-dashboard-content).
 *
 * Uso:
 *   <script src="src/features/calculadora.js"></script>
 *   POSCalculator.init('calculadora-container');
 */

window.POSCalculator = (function() {

    var displayValue = '0';
    var previousValue = '';
    var operation = null;
    var shouldResetDisplay = false;
    var history = [];
    var containerEl = null;

    /**
     * Inicializa la calculadora en el contenedor indicado.
     * @param {string} containerId - ID del contenedor (default 'calculadora-container')
     */
    function init(containerId) {
        containerId = containerId || 'calculadora-container';
        var container = document.getElementById(containerId);

        if (!container) {
            // Insertar en el modal de checkout
            var checkoutBody = document.querySelector('#checkout-modal .overflow-y-auto');
            if (checkoutBody) {
                container = document.createElement('div');
                container.id = containerId;
                container.className = 'calculadora-container checkout-calc';
                // Insertar antes de las observaciones
                var obsSection = checkoutBody.querySelector('.border-t');
                if (obsSection) {
                    checkoutBody.insertBefore(container, obsSection);
                } else {
                    checkoutBody.appendChild(container);
                }
            } else {
                console.warn('[POSCalculator] No se encontró el modal de checkout.');
                return;
            }
        }

        containerEl = container;
        injectStyles();
        render();
    }

    function render() {
        if (!containerEl) return;

        containerEl.innerHTML =
            '<div class="calc-wrapper">' +
                '<div class="calc-header">' +
                    '<i class="fas fa-calculator"></i> Calculadora' +
                    '<button class="calc-toggle" onclick="POSCalculator.toggle()">' +
                        '<i class="fas fa-chevron-up"></i>' +
                    '</button>' +
                '</div>' +
                '<div class="calc-body" style="display: none;">' +
                    '<div class="calc-display" id="calc-display">' +
                        '<div class="calc-expression" id="calc-expression"></div>' +
                        '<div class="calc-result" id="calc-result">0</div>' +
                    '</div>' +
                    '<div class="calc-buttons">' +
                        '<button class="calc-btn calc-btn-func" onclick="POSCalculator.clear()">AC</button>' +
                        '<button class="calc-btn calc-btn-func" onclick="POSCalculator.backspace()"><i class="fas fa-delete-left"></i></button>' +
                        '<button class="calc-btn calc-btn-func" onclick="POSCalculator.toggleSign()">±</button>' +
                        '<button class="calc-btn calc-btn-op" onclick="POSCalculator.pressOp(\'/\')">÷</button>' +

                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(7)">7</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(8)">8</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(9)">9</button>' +
                        '<button class="calc-btn calc-btn-op" onclick="POSCalculator.pressOp(\'*\')">×</button>' +

                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(4)">4</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(5)">5</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(6)">6</button>' +
                        '<button class="calc-btn calc-btn-op" onclick="POSCalculator.pressOp(\'-\')">−</button>' +

                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(1)">1</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(2)">2</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDigit(3)">3</button>' +
                        '<button class="calc-btn calc-btn-op" onclick="POSCalculator.pressOp(\'+\')">+</button>' +

                        '<button class="calc-btn calc-btn-zero" onclick="POSCalculator.pressDigit(0)">0</button>' +
                        '<button class="calc-btn" onclick="POSCalculator.pressDot()">.</button>' +
                        '<button class="calc-btn calc-btn-eq" onclick="POSCalculator.calculate()">=</button>' +
                    '</div>' +
                    '<div class="calc-footer">' +
                        '<button class="calc-send-btn" onclick="POSCalculator.sendToCart()" title="Enviar al carrito">' +
                            '<i class="fas fa-cart-plus"></i> Enviar a carrito' +
                        '</button>' +
                        '<button class="calc-copy-btn" onclick="POSCalculator.copyResult()" title="Copiar">' +
                            '<i class="fas fa-copy"></i> Copiar' +
                        '</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
    }

    function updateDisplay() {
        var resultEl = document.getElementById('calc-result');
        var exprEl = document.getElementById('calc-expression');
        if (!resultEl) return;

        resultEl.textContent = formatNumber(displayValue);

        if (exprEl) {
            if (operation && previousValue) {
                exprEl.textContent = formatNumber(previousValue) + ' ' + opSymbol(operation);
            } else {
                exprEl.textContent = '';
            }
        }
    }

    function pressDigit(digit) {
        if (shouldResetDisplay) {
            displayValue = String(digit);
            shouldResetDisplay = false;
        } else {
            if (displayValue === '0' && digit !== '.') {
                displayValue = String(digit);
            } else {
                displayValue += String(digit);
            }
        }
        updateDisplay();
    }

    function pressOp(op) {
        if (operation && !shouldResetDisplay) {
            calculate();
        }
        previousValue = displayValue;
        operation = op;
        shouldResetDisplay = true;
        updateDisplay();
    }

    function calculate() {
        if (!operation) return;

        var prev = parseFloat(previousValue);
        var curr = parseFloat(displayValue);
        var result = 0;

        switch (operation) {
            case '+': result = prev + curr; break;
            case '-': result = prev - curr; break;
            case '*': result = prev * curr; break;
            case '/':
                if (curr === 0) {
                    displayValue = 'Error';
                    updateDisplay();
                    operation = null;
                    previousValue = '';
                    shouldResetDisplay = true;
                    return;
                }
                result = prev / curr;
                break;
        }

        result = Math.round(result * 1000000) / 1000000;

        // Guardar en historial
        history.push(prev + ' ' + opSymbol(operation) + ' ' + curr + ' = ' + formatNumber(result));

        displayValue = String(result);
        operation = null;
        previousValue = '';
        shouldResetDisplay = true;
        updateDisplay();
    }

    function clear() {
        displayValue = '0';
        previousValue = '';
        operation = null;
        shouldResetDisplay = false;
        updateDisplay();
    }

    function backspace() {
        if (shouldResetDisplay) return;
        if (displayValue.length <= 1) {
            displayValue = '0';
        } else {
            displayValue = displayValue.slice(0, -1);
        }
        updateDisplay();
    }

    function toggleSign() {
        if (displayValue !== '0') {
            displayValue = displayValue.startsWith('-')
                ? displayValue.slice(1)
                : '-' + displayValue;
        }
        updateDisplay();
    }

    function pressDot() {
        if (shouldResetDisplay) {
            displayValue = '0.';
            shouldResetDisplay = false;
            updateDisplay();
            return;
        }
        if (!displayValue.includes('.')) {
            displayValue += '.';
        }
        updateDisplay();
    }

    function toggle() {
        if (!containerEl) return;
        var body = containerEl.querySelector('.calc-body');
        var icon = containerEl.querySelector('.calc-toggle i');
        if (body) {
            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? '' : 'none';
            if (icon) {
                icon.className = isHidden ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            }
        }
    }

    /**
     * Envía el resultado al carrito como nota/recordatorio
     */
    function sendToCart() {
        var val = displayValue;
        if (val === '0' || val === 'Error') return;

        var amount = parseFloat(val);
        if (isNaN(amount)) return;

        Swal.fire({
            title: 'Enviar al carrito',
            input: 'text',
            inputValue: '$' + amount.toFixed(2),
            text: '¿Agregar como nota al carrito?',
            showCancelButton: true,
            confirmButtonText: 'Agregar',
            cancelButtonText: 'Cancelar'
        }).then(function(res) {
            if (res.isConfirmed) {
                // Agregar una nota temporal al carrito
                var cartEl = document.querySelector('#cart-items-container .cart-note') ||
                            document.querySelector('.cart-summary') ||
                            document.querySelector('#checkout-total');
                if (cartEl) {
                    var note = document.createElement('div');
                    note.className = 'calc-cart-note';
                    note.style.cssText = 'background:#fef3c7;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:600;color:#92400e;margin-top:4px;';
                    note.textContent = '🧮 Calculado: $' + amount.toFixed(2);
                    cartEl.parentNode.insertBefore(note, cartEl.nextSibling);
                    setTimeout(function() { note.remove(); }, 10000);
                }
                Swal.fire({
                    icon: 'success',
                    title: 'Enviado',
                    text: '$' + amount.toFixed(2) + ' — puedes usarlo como referencia',
                    timer: 1500,
                    showConfirmButton: false
                });
            }
        });
    }

    /**
     * Copia el resultado al portapapeles
     */
    function copyResult() {
        var val = displayValue;
        if (val === 'Error') val = '0';

        var textarea = document.createElement('textarea');
        textarea.value = val;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        // Feedback visual
        var btn = containerEl && containerEl.querySelector('.calc-copy-btn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-check"></i> Copiado';
            setTimeout(function() {
                btn.innerHTML = '<i class="fas fa-copy"></i> Copiar';
            }, 1500);
        }
    }

    // ──────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────

    function formatNumber(n) {
        if (isNaN(parseFloat(n))) return n;
        var parts = String(n).split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return parts.join('.');
    }

    function opSymbol(op) {
        switch (op) {
            case '+': return '+';
            case '-': return '−';
            case '*': return '×';
            case '/': return '÷';
            default: return op;
        }
    }

    // ──────────────────────────────────────────────
    // CSS
    // ──────────────────────────────────────────────

    function injectStyles() {
        if (document.getElementById('poscalculator-styles')) return;

        var css = document.createElement('style');
        css.id = 'poscalculator-styles';
        css.textContent = `
            .calculadora-container {
                margin-bottom: 16px;
            }
            .checkout-calc {
                margin-top: 12px;
                margin-bottom: 0;
            }
            .checkout-calc .calc-wrapper {
                max-width: 100%;
            }
            .calc-wrapper {
                background: #1e293b;
                border-radius: 20px;
                overflow: hidden;
                border: 1px solid #334155;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                max-width: 320px;
            }
            .calc-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 16px;
                background: #0f172a;
                color: #94a3b8;
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .calc-header i {
                margin-right: 8px;
                color: #6366f1;
            }
            .calc-toggle {
                background: none;
                border: none;
                color: #64748b;
                cursor: pointer;
                padding: 4px;
                font-size: 12px;
            }
            .calc-toggle:hover {
                color: #94a3b8;
            }
            .calc-body {
                padding: 12px;
                transition: all 0.2s;
            }
            .calc-display {
                background: #0f172a;
                border-radius: 12px;
                padding: 12px 16px;
                margin-bottom: 12px;
                text-align: right;
                min-height: 60px;
            }
            .calc-expression {
                font-size: 11px;
                color: #64748b;
                min-height: 16px;
                word-break: break-all;
            }
            .calc-result {
                font-size: 28px;
                font-weight: 800;
                color: #e2e8f0;
                font-family: 'Courier New', monospace;
                word-break: break-all;
                line-height: 1.2;
            }
            .calc-buttons {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 6px;
                margin-bottom: 8px;
            }
            .calc-btn {
                background: #334155;
                border: none;
                border-radius: 10px;
                padding: 12px 0;
                font-size: 16px;
                font-weight: 700;
                color: #e2e8f0;
                cursor: pointer;
                transition: all 0.1s;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: inherit;
            }
            .calc-btn:hover {
                background: #475569;
                transform: scale(0.95);
            }
            .calc-btn:active {
                transform: scale(0.90);
            }
            .calc-btn-op {
                background: #1e3a5f;
                color: #6366f1;
            }
            .calc-btn-op:hover {
                background: #1e40af;
                color: #93c5fd;
            }
            .calc-btn-func {
                background: #0f172a;
                color: #f59e0b;
                font-size: 13px;
            }
            .calc-btn-func:hover {
                background: #1e293b;
            }
            .calc-btn-zero {
                grid-column: span 1;
            }
            .calc-btn-eq {
                background: #6366f1;
                color: white;
                font-size: 20px;
            }
            .calc-btn-eq:hover {
                background: #4f46e5;
            }
            .calc-footer {
                display: flex;
                gap: 6px;
            }
            .calc-send-btn, .calc-copy-btn {
                flex: 1;
                background: #334155;
                border: none;
                border-radius: 10px;
                padding: 8px 0;
                font-size: 11px;
                font-weight: 700;
                color: #94a3b8;
                cursor: pointer;
                transition: all 0.15s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
            }
            .calc-send-btn:hover, .calc-copy-btn:hover {
                background: #475569;
                color: #e2e8f0;
            }
            .calc-send-btn {
                background: #065f46;
                color: #6ee7b7;
            }
            .calc-send-btn:hover {
                background: #047857;
            }
            .calc-cart-note {
                animation: fadeInNote 0.3s ease;
            }
            @keyframes fadeInNote {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(css);
    }

    // ──────────────────────────────────────────────
    // API PÚBLICA
    // ──────────────────────────────────────────────

    return {
        init: init,
        pressDigit: pressDigit,
        pressOp: pressOp,
        pressDot: pressDot,
        calculate: calculate,
        clear: clear,
        backspace: backspace,
        toggleSign: toggleSign,
        toggle: toggle,
        sendToCart: sendToCart,
        copyResult: copyResult,
        getDisplayValue: function() { return displayValue; }
    };

})();


