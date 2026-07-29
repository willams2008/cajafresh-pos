/**
 * Funciones Pendientes — Módulo de funcionalidades faltantes del POS
 *
 * Agrupa todas las carencias identificadas en el análisis del sistema:
 * Dashboard, anulaciones, ajustes de stock, proveedores, clientes, etc.
 *
 * Modo de uso:
 *   <script src="src/renderer/funciones-pendientes.js"></script>
 *   POSExtensions.voidSale(ticketNum);
 *   POSExtensions.adjustStock(productId, newStock, reason);
 *
 * Diseñado para funcionar con las estructuras globales existentes
 * (sales, products, clients, expenses, dailyHistory, auditLogs, settings).
 */

window.POSExtensions = (function() {

    // ──────────────────────────────────────────────
    // 1. DASHBOARD / INICIO
    // ──────────────────────────────────────────────

    /**
     * Renderiza un dashboard de inicio con resumen del día.
     * Crea el HTML si no existe y lo inyecta en un contenedor.
     * @param {Array} sales
     * @param {Array} products
     * @param {Array} expenses
     * @param {Object} settings
     */
    function renderDashboard(sales, products, expenses, settings) {
        const today = new Date().toISOString().slice(0, 10);
        const todaySales = sales.filter(s => s.date && s.date.slice(0, 10) === today && s.status !== 'voided' && s.status !== 'void');

        const grossSalesUSD = todaySales.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const grossSalesVES = todaySales.reduce((sum, s) => sum + (Number(s.totalVES) || 0), 0);
        const totalTickets = todaySales.length;
        const totalItems = todaySales.reduce((sum, s) => {
            return sum + (Array.isArray(s.items) ? s.items.reduce((a, i) => a + (Number(i.qty) || 0), 0) : 0);
        }, 0);

        const totalCost = todaySales.reduce((sum, s) => sum + (Number(s.totalCostUSD) || 0), 0);
        const grossProfit = grossSalesUSD - totalCost;
        const expenseTotal = (expenses || []).reduce((sum, e) => sum + (Number(e.amountUSD) || 0), 0);

        const lowStockItems = products.filter(p => Number(p.stock) <= Number(p.minStock));
        const pendingCredits = sales.filter(s => s.status === 'pending');
        const pendingTotal = pendingCredits.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);

        const container = document.getElementById('view-dashboard-content');
        if (!container) {
            console.warn('[POSExtensions] No existe #view-dashboard-content. Crea el contenedor en index.html');
            return;
        }

        const formatUSD = (n) => '$' + (Number(n) || 0).toFixed(2);
        const formatVES = (n) => 'Bs ' + (Number(n) || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');

        container.innerHTML = `
            <div class="space-y-6">
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ventas Hoy (USD)</p>
                        <h3 class="text-2xl font-black text-slate-800 mt-1">${formatUSD(grossSalesUSD)}</h3>
                    </div>
                    <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Ventas Hoy (VES)</p>
                        <h3 class="text-2xl font-black text-slate-800 mt-1">${formatVES(grossSalesVES)}</h3>
                    </div>
                    <div class="bg-emerald-50 rounded-2xl p-5 shadow-sm border border-emerald-100">
                        <p class="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Ganancia Bruta</p>
                        <h3 class="text-2xl font-black text-emerald-700 mt-1">${formatUSD(Math.max(0, grossProfit))}</h3>
                    </div>
                    <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Tickets / Artículos</p>
                        <h3 class="text-2xl font-black text-slate-800 mt-1">${totalTickets} / ${totalItems}</h3>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div class="bg-amber-50 rounded-2xl p-5 shadow-sm border border-amber-100">
                        <p class="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Stock Bajo</p>
                        <p class="text-2xl font-black text-amber-700 mt-1">${lowStockItems.length}</p>
                        <ul class="mt-2 text-xs text-amber-800 space-y-1">
                            ${lowStockItems.slice(0, 5).map(p => `<li>• ${p.name}: ${p.stock} (mín ${p.minStock})</li>`).join('')}
                            ${lowStockItems.length > 5 ? `<li class="text-amber-500 font-bold">+${lowStockItems.length - 5} más...</li>` : ''}
                        </ul>
                    </div>
                    <div class="bg-red-50 rounded-2xl p-5 shadow-sm border border-red-100">
                        <p class="text-[10px] font-bold text-red-600 uppercase tracking-widest">Créditos Pendientes</p>
                        <p class="text-2xl font-black text-red-700 mt-1">${pendingCredits.length}</p>
                        <p class="text-sm font-bold text-red-600 mt-1">Total: ${formatUSD(pendingTotal)}</p>
                    </div>
                    <div class="bg-blue-50 rounded-2xl p-5 shadow-sm border border-blue-100">
                        <p class="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Gastos del Día</p>
                        <p class="text-2xl font-black text-blue-700 mt-1">${formatUSD(expenseTotal)}</p>
                        <p class="text-xs text-blue-600 mt-1">Margen neto: ${formatUSD(Math.max(0, grossProfit - expenseTotal))}</p>
                    </div>
                </div>

                <div class="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Últimas Ventas</p>
                    <table class="w-full text-left text-sm">
                        <thead><tr class="text-[10px] text-slate-400 uppercase font-bold">
                            <th class="pb-2">Ticket</th>
                            <th class="pb-2">Cliente</th>
                            <th class="pb-2">Monto</th>
                            <th class="pb-2">Método</th>
                            <th class="pb-2">Hora</th>
                        </tr></thead>
                        <tbody>
                            ${todaySales.slice(-5).reverse().map(s => `
                                <tr class="border-t border-slate-50">
                                    <td class="py-2 font-bold">#${s.ticket || s.id}</td>
                                    <td class="py-2">${s.client?.name || 'Final'}</td>
                                    <td class="py-2 font-bold">${formatUSD(s.totalUSD)}</td>
                                    <td class="py-2">${s.method || 'cash-usd'}</td>
                                    <td class="py-2 text-slate-400">${s.date ? new Date(s.date).toLocaleTimeString('es-VE', {hour:'2-digit', minute:'2-digit'}) : ''}</td>
                                </tr>
                            `).join('')}
                            ${todaySales.length === 0 ? '<tr><td colspan="5" class="py-6 text-center text-slate-400 italic">Sin ventas hoy</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // ──────────────────────────────────────────────
    // 2. ANULAR / DEVOLVER VENTA
    // ──────────────────────────────────────────────

    /**
     * Anula una venta: restaura stock, marca como voided, registra auditoría.
     * @param {string} ticketNum - Número de ticket a anular
     * @param {string} reason - Motivo de la anulación
     * @returns {boolean} true si se anuló correctamente
     */
    function voidSale(ticketNum, reason) {
        const saleIndex = sales.findIndex(s => (s.ticket === ticketNum || s.id === ticketNum) && s.status !== 'voided' && s.status !== 'void');
        if (saleIndex === -1) {
            Swal.fire('Error', 'Venta no encontrada o ya anulada', 'error');
            return false;
        }

        const sale = sales[saleIndex];

        // Restaurar stock de cada item
        if (Array.isArray(sale.items)) {
            sale.items.forEach(item => {
                const prod = products.find(p => p.id === item.id || p.id === item.parentId);
                if (prod) {
                    prod.stock = (Number(prod.stock) || 0) + (Number(item.qty) || 0);
                }
            });
        }

        // Marcar como anulada
        sale.status = 'voided';
        sale.voidedAt = new Date().toISOString();
        sale.voidReason = reason || 'Anulación manual';

        saveProducts();
        saveSales();

        // Auditoría
        if (typeof logAction === 'function') {
            logAction('SALE_VOID', `Venta #${ticketNum} anulada: ${reason}`, { totalUSD: sale.totalUSD, method: sale.method });
        }

        renderReports();
        if (typeof renderAnalytics === 'function') renderAnalytics();
        if (typeof renderDashboard === 'function') renderDashboard(sales, products, expenses, settings);

        Swal.fire('Venta Anulada', `Ticket #${ticketNum} anulado. Stock restaurado.`, 'success');
        return true;
    }

    /**
     * Abre modal para seleccionar venta y anularla con motivo.
     */
    function openVoidSaleModal() {
        const completedSales = sales.filter(s => s.status !== 'voided' && s.status !== 'void');
        if (completedSales.length === 0) {
            Swal.fire('Sin ventas', 'No hay ventas para anular.', 'info');
            return;
        }

        const options = completedSales.slice(-20).reverse().map(s => ({
            ticket: s.ticket || s.id,
            label: `#${s.ticket || s.id} — ${formatUSDshort(s.totalUSD)} — ${s.client?.name || 'Final'} (${s.date ? new Date(s.date).toLocaleTimeString('es-VE', {hour:'2-digit', minute:'2-digit'}) : ''})`,
            sale: s
        }));

        const selectHtml = options.map(o =>
            `<option value="${o.ticket}">${o.label}</option>`
        ).join('');

        Swal.fire({
            title: 'Anular Venta',
            html: `
                <label class="block text-left text-sm font-bold text-slate-600 mb-1">Seleccionar Venta</label>
                <select id="swal-void-ticket" class="swal2-input" style="height:auto; padding:10px">${selectHtml}</select>
                <label class="block text-left text-sm font-bold text-slate-600 mt-4 mb-1">Motivo de Anulación</label>
                <textarea id="swal-void-reason" class="swal2-input" placeholder="Ej: Error en el cobro, producto dañado..." style="height:80px"></textarea>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Sí, anular venta',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const ticket = document.getElementById('swal-void-ticket').value;
                const reason = document.getElementById('swal-void-reason').value.trim() || 'Sin motivo';
                return { ticket, reason };
            }
        }).then(res => {
            if (res.isConfirmed) {
                voidSale(res.value.ticket, res.value.reason);
            }
        });
    }

    // ──────────────────────────────────────────────
    // 3. AJUSTE DE STOCK MANUAL
    // ──────────────────────────────────────────────

    /**
     * Ajusta el stock de un producto manualmente, registrando auditoría.
     * @param {string} productId
     * @param {number} newStock - Nuevo valor de stock
     * @param {string} reason - Motivo del ajuste
     */
    function adjustStock(productId, newStock, reason) {
        const prod = products.find(p => p.id === productId);
        if (!prod) {
            Swal.fire('Error', 'Producto no encontrado', 'error');
            return;
        }

        const oldStock = Number(prod.stock) || 0;
        newStock = Math.max(0, Number(newStock) || 0);

        prod.stock = newStock;
        saveProducts();

        if (typeof logAction === 'function') {
            logAction('STOCK_ADJUST',
                `Ajuste de stock: ${prod.name} (${oldStock} → ${newStock})`,
                { productId, productName: prod.name, oldStock, newStock, reason }
            );
        }

        // Refrescar vistas
        if (typeof renderInventory === 'function') renderInventory();

        Swal.fire({
            icon: 'success',
            title: 'Stock Ajustado',
            text: `${prod.name}: ${oldStock} → ${newStock} (${reason})`,
            timer: 2000,
            showConfirmButton: false
        });
    }

    /**
     * Abre modal para ajustar stock de un producto.
     */
    function openStockAdjustModal() {
        const productOptions = products
            .filter(p => p.name)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p =>
                `<option value="${p.id}">${p.name} (stock actual: ${p.stock})</option>`
            ).join('');

        Swal.fire({
            title: 'Ajustar Stock Manual',
            html: `
                <label class="block text-left text-sm font-bold text-slate-600 mb-1">Producto</label>
                <select id="swal-adjust-product" class="swal2-input" style="height:auto; padding:10px">${productOptions || '<option>No hay productos</option>'}</select>
                <label class="block text-left text-sm font-bold text-slate-600 mt-4 mb-1">Nuevo Stock</label>
                <input id="swal-adjust-qty" type="number" min="0" class="swal2-input" placeholder="0">
                <label class="block text-left text-sm font-bold text-slate-600 mt-4 mb-1">Motivo del Ajuste</label>
                <select id="swal-adjust-reason" class="swal2-input" style="height:auto; padding:10px">
                    <option value="Inventario físico">Inventario físico (conteo)</option>
                    <option value="Producto dañado">Producto dañado / pérdida</option>
                    <option value="Error de carga">Error de carga inicial</option>
                    <option value="Devolución">Devolución de cliente</option>
                    <option value="Merma">Merma / vencimiento</option>
                    <option value="Otro">Otro</option>
                </select>
                <textarea id="swal-adjust-detail" class="swal2-input" placeholder="Detalle adicional (opcional)" style="height:60px"></textarea>
            `,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#f59e0b',
            confirmButtonText: 'Ajustar Stock',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const productId = document.getElementById('swal-adjust-product').value;
                const newStock = parseInt(document.getElementById('swal-adjust-qty').value);
                const reason = document.getElementById('swal-adjust-reason').value;
                const detail = document.getElementById('swal-adjust-detail').value.trim();
                if (isNaN(newStock) || newStock < 0) {
                    Swal.showValidationMessage('Ingresa un número válido (≥ 0)');
                    return;
                }
                return { productId, newStock, reason: reason + (detail ? ': ' + detail : '') };
            }
        }).then(res => {
            if (res.isConfirmed) {
                adjustStock(res.value.productId, res.value.newStock, res.value.reason);
            }
        });
    }

    // ──────────────────────────────────────────────
    // 4. PROVEEDORES (CRUD)
    // ──────────────────────────────────────────────

    const SUPPLIERS_KEY = 'freshpos_suppliers';

    function getSuppliers() {
        const raw = localStorage.getItem(SUPPLIERS_KEY);
        return raw ? safeJSONParse(raw) : [];
    }

    function saveSuppliers(list) {
        localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(list));
    }

    /**
     * Renderiza la tabla de proveedores.
     * @param {string} containerId - ID del contenedor donde inyectar la tabla
     */
    function renderSuppliers(containerId) {
        const container = document.getElementById(containerId || 'suppliers-table-body');
        if (!container) return;

        const list = getSuppliers();

        if (list.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-slate-400 italic">No hay proveedores registrados</td></tr>';
            return;
        }

        container.innerHTML = list.map((s, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="py-3 px-4 font-bold text-slate-700">${s.name}</td>
                <td class="py-3 px-4 text-slate-500">${s.contact || '-'}</td>
                <td class="py-3 px-4 text-slate-500">${s.phone || '-'}</td>
                <td class="py-3 px-4 text-slate-500">${s.email || '-'}</td>
                <td class="py-3 px-4 text-right">
                    <button onclick="POSExtensions.editSupplier(${i})" class="text-brand-600 hover:bg-brand-50 p-2 rounded-lg transition-colors" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="POSExtensions.deleteSupplier(${i})" class="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function openSupplierModal(editIndex) {
        const list = getSuppliers();
        const existing = (editIndex !== undefined && editIndex !== null) ? list[editIndex] : null;

        Swal.fire({
            title: existing ? 'Editar Proveedor' : 'Nuevo Proveedor',
            html: `
                <input id="sup-name" class="swal2-input" placeholder="Nombre del proveedor" value="${existing?.name || ''}">
                <input id="sup-contact" class="swal2-input" placeholder="Persona de contacto" value="${existing?.contact || ''}">
                <input id="sup-phone" class="swal2-input" placeholder="Teléfono" value="${existing?.phone || ''}">
                <input id="sup-email" class="swal2-input" placeholder="Email" value="${existing?.email || ''}" type="email">
                <textarea id="sup-address" class="swal2-input" placeholder="Dirección" style="height:60px">${existing?.address || ''}</textarea>
                <input id="sup-notes" class="swal2-input" placeholder="Notas (opcional)" value="${existing?.notes || ''}">
            `,
            showCancelButton: true,
            confirmButtonText: existing ? 'Guardar Cambios' : 'Agregar Proveedor',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const name = document.getElementById('sup-name').value.trim();
                if (!name) {
                    Swal.showValidationMessage('El nombre del proveedor es obligatorio');
                    return;
                }
                return {
                    id: existing?.id || 'sup_' + Date.now(),
                    name,
                    contact: document.getElementById('sup-contact').value.trim(),
                    phone: document.getElementById('sup-phone').value.trim(),
                    email: document.getElementById('sup-email').value.trim(),
                    address: document.getElementById('sup-address').value.trim(),
                    notes: document.getElementById('sup-notes').value.trim(),
                    createdAt: existing?.createdAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            }
        }).then(res => {
            if (!res.isConfirmed) return;

            if (existing) {
                list[editIndex] = res.value;
            } else {
                list.push(res.value);
            }
            saveSuppliers(list);
            renderSuppliers();

            Swal.fire({
                icon: 'success',
                title: existing ? 'Proveedor Actualizado' : 'Proveedor Agregado',
                timer: 1500,
                showConfirmButton: false
            });
        });
    }

    function editSupplier(index) {
        openSupplierModal(index);
    }

    function deleteSupplier(index) {
        const list = getSuppliers();
        const name = list[index]?.name || '';

        Swal.fire({
            title: '¿Eliminar Proveedor?',
            text: `Se eliminará "${name}" permanentemente.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar'
        }).then(res => {
            if (res.isConfirmed) {
                list.splice(index, 1);
                saveSuppliers(list);
                renderSuppliers();
                Swal.fire('Eliminado', '', 'success');
            }
        });
    }

    // ──────────────────────────────────────────────
    // 5. HISTORIAL DE COMPRAS POR CLIENTE
    // ──────────────────────────────────────────────

    /**
     * Muestra el historial de compras de un cliente
     * @param {string} clientName
     * @param {string} clientDoc
     */
    function showClientHistory(clientName, clientDoc) {
        const clientSales = sales.filter(s =>
            s.client &&
            (s.client.name === clientName || s.client.document === clientDoc) &&
            s.status !== 'voided' && s.status !== 'void'
        );

        if (clientSales.length === 0) {
            Swal.fire('Sin historial', 'Este cliente no tiene compras registradas.', 'info');
            return;
        }

        const totalSpent = clientSales.reduce((sum, s) => sum + (Number(s.totalUSD) || 0), 0);
        const totalTickets = clientSales.length;
        const avgTicket = totalSpent / totalTickets;

        let productsMap = {};
        clientSales.forEach(s => {
            if (!Array.isArray(s.items)) return;
            s.items.forEach(item => {
                const key = item.id || item.name;
                if (!productsMap[key]) productsMap[key] = { name: item.name, qty: 0, total: 0 };
                productsMap[key].qty += Number(item.qty) || 0;
                productsMap[key].total += (Number(item.unitPriceUSD) || 0) * (Number(item.qty) || 0);
            });
        });

        const topProducts = Object.values(productsMap)
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);

        Swal.fire({
            title: `Historial: ${clientName}`,
            width: 600,
            html: `
                <div class="text-left space-y-4">
                    <div class="grid grid-cols-3 gap-3">
                        <div class="bg-slate-50 p-3 rounded-xl">
                            <p class="text-[10px] font-bold text-slate-400 uppercase">Compras</p>
                            <p class="text-xl font-black text-slate-800">${totalTickets}</p>
                        </div>
                        <div class="bg-emerald-50 p-3 rounded-xl">
                            <p class="text-[10px] font-bold text-emerald-600 uppercase">Total Gastado</p>
                            <p class="text-xl font-black text-emerald-700">${formatUSDshort(totalSpent)}</p>
                        </div>
                        <div class="bg-brand-50 p-3 rounded-xl">
                            <p class="text-[10px] font-bold text-brand-600 uppercase">Ticket Prom.</p>
                            <p class="text-xl font-black text-brand-700">${formatUSDshort(avgTicket)}</p>
                        </div>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-500 uppercase mb-2">Productos más comprados</p>
                        <table class="w-full text-left text-sm">
                            <thead><tr class="text-[10px] text-slate-400 uppercase font-bold">
                                <th class="pb-1">Producto</th>
                                <th class="pb-1 text-center">Cant</th>
                                <th class="pb-1 text-right">Total</th>
                            </tr></thead>
                            <tbody>
                                ${topProducts.map(p => `
                                    <tr class="border-t border-slate-50">
                                        <td class="py-1 font-medium">${p.name}</td>
                                        <td class="py-1 text-center">${p.qty}</td>
                                        <td class="py-1 text-right font-bold">${formatUSDshort(p.total)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div>
                        <p class="text-xs font-bold text-slate-500 uppercase mb-2">Últimas compras</p>
                        ${clientSales.slice(-5).reverse().map(s => `
                            <div class="flex justify-between items-center py-1 border-t border-slate-50 text-sm">
                                <span class="text-slate-400">#${s.ticket || s.id} — ${s.date ? new Date(s.date).toLocaleDateString('es-VE') : ''}</span>
                                <span class="font-bold">${formatUSDshort(s.totalUSD)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `,
            confirmButtonText: 'Cerrar'
        });
    }

    // ──────────────────────────────────────────────
    // 6. EXPORTAR INVENTARIO A CSV
    // ──────────────────────────────────────────────

    function exportInventoryCSV(products) {
        if (!products || products.length === 0) {
            Swal.fire('Sin datos', 'No hay productos para exportar.', 'info');
            return;
        }

        const headers = ['ID', 'Nombre', 'Categoría', 'Stock', 'Stock Mínimo', 'Costo (USD)', 'Precio USD', 'Precio VES', 'Precio EUR', 'Código Barras'];
        const rows = products.map(p => [
            p.id || '',
            `"${(p.name || '').replace(/"/g, '""')}"`,
            `"${(p.category || '').replace(/"/g, '""')}"`,
            p.stock || 0,
            p.minStock || 0,
            p.costPrice || 0,
            p.priceUSD || p.price || 0,
            p.priceVES || 0,
            p.priceEUR || 0,
            p.barcode || ''
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inventario-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ──────────────────────────────────────────────
    // 7. IMPORTAR PRODUCTOS DESDE CSV
    // ──────────────────────────────────────────────

    function importInventoryCSV(file, products) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const text = e.target.result;
                    const lines = text.split('\n').filter(l => l.trim());
                    if (lines.length < 2) {
                        reject(new Error('CSV vacío o sin datos'));
                        return;
                    }

                    const headers = parseCSVLine(lines[0]);
                    const nameIdx = headers.findIndex(h => /nombre/i.test(h));
                    const stockIdx = headers.findIndex(h => /stock/i.test(h));
                    const costIdx = headers.findIndex(h => /costo/i.test(h));
                    const priceUsdIdx = headers.findIndex(h => /precio.*usd|price.*usd/i.test(h));
                    const priceVesIdx = headers.findIndex(h => /precio.*ves|price.*ves/i.test(h));
                    const catIdx = headers.findIndex(h => /categor/i.test(h));
                    const minStockIdx = headers.findIndex(h => /stock.*min|min.*stock/i.test(h));
                    const barcodeIdx = headers.findIndex(h => /codigo.*barras?|barcode/i.test(h));

                    if (nameIdx === -1) {
                        reject(new Error('No se encontró columna "Nombre" en el CSV'));
                        return;
                    }

                    let added = 0, updated = 0, skipped = 0;

                    for (let i = 1; i < lines.length; i++) {
                        const cols = parseCSVLine(lines[i]);
                        const name = (cols[nameIdx] || '').trim();
                        if (!name) { skipped++; continue; }

                        const existing = products.find(p => p.name.toLowerCase() === name.toLowerCase());
                        const stock = parseInt(cols[stockIdx]) || 0;
                        const costPrice = parseFloat((cols[costIdx] || '').replace(/[$,]/g, '')) || 0;
                        const priceUSD = parseFloat((cols[priceUsdIdx] || '').replace(/[$,]/g, '')) || 0;
                        const priceVES = parseFloat((cols[priceVesIdx] || '').replace(/[$,]/g, '')) || 0;
                        const category = catIdx >= 0 ? cols[catIdx] : 'General';
                        const minStock = minStockIdx >= 0 ? parseInt(cols[minStockIdx]) || 0 : 0;
                        const barcode = barcodeIdx >= 0 ? cols[barcodeIdx] || '' : '';

                        if (existing) {
                            if (stock > 0) existing.stock = stock;
                            if (costPrice > 0) existing.costPrice = costPrice;
                            if (priceUSD > 0) existing.priceUSD = priceUSD;
                            if (priceVES > 0) existing.priceVES = priceVES;
                            existing.category = category;
                            existing.minStock = minStock;
                            if (barcode) existing.barcode = barcode;
                            updated++;
                        } else {
                            // Generar ID incremental (basado en timestamp + índice)
                            const newId = 'prod_' + Date.now() + '_' + i;
                            products.push({
                                id: newId,
                                name: name,
                                category: category,
                                price: priceUSD || priceVES || 0,
                                priceUSD: priceUSD,
                                priceVES: priceVES,
                                priceEUR: 0,
                                costPrice: costPrice,
                                stock: stock,
                                minStock: minStock,
                                barcode: barcode,
                                img: ''
                            });
                            added++;
                        }
                    }

                    saveProducts();
                    resolve({ added, updated, skipped, total: lines.length - 1 });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Error leyendo archivo'));
            reader.readAsText(file);
        });
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if (ch === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    }

    /**
     * Abre diálogo para seleccionar archivo CSV e importar productos
     */
    function openImportCSVDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            Swal.fire({
                title: 'Importando...',
                text: 'Procesando archivo CSV',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            importInventoryCSV(file, products)
                .then(result => {
                    Swal.fire({
                        icon: 'success',
                        title: 'Importación Completa',
                        html: `
                            <p class="text-sm">${result.total} líneas procesadas</p>
                            <ul class="text-xs mt-2 space-y-1">
                                <li>✅ <b>${result.added}</b> productos nuevos</li>
                                <li>📝 <b>${result.updated}</b> productos actualizados</li>
                                ${result.skipped > 0 ? `<li>⚠️ <b>${result.skipped}</b> líneas saltadas (sin nombre)</li>` : ''}
                            </ul>
                        `,
                        confirmButtonText: 'OK'
                    });
                    if (typeof renderInventory === 'function') renderInventory();
                    if (typeof renderProducts === 'function') renderProducts();
                })
                .catch(err => {
                    Swal.fire('Error', err.message, 'error');
                });
        };
        input.click();
    }

    // ──────────────────────────────────────────────
    // 8. FILTRO DE REPORTES POR RANGO DE FECHA
    // ──────────────────────────────────────────────

    /**
     * Filtra ventas por rango de fecha y renderiza resultados.
     * @param {Array} sales
     * @param {string} startDate - YYYY-MM-DD
     * @param {string} endDate - YYYY-MM-DD
     * @param {Function} renderFn - Función de renderizado (ej: renderReports)
     */
    function filterSalesByDateRange(sales, startDate, endDate, renderFn) {
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T23:59:59');

        const filtered = sales.filter(s => {
            const d = new Date(s.date);
            return d >= start && d <= end && s.status !== 'voided' && s.status !== 'void';
        });

        if (typeof renderFn === 'function') {
            renderFn(filtered);
        }

        return filtered;
    }

    /**
     * Desglose por método de pago para un conjunto de ventas.
     * @param {Array} salesList
     * @returns {Object} { cashUSD, cashVES, cardVES, pagoMovil, cashEUR, other }
     */
    function paymentMethodBreakdown(salesList) {
        const breakdown = { 'cash-usd': 0, 'cash-ves': 0, 'card-ves': 0, 'pago-movil': 0, 'cash-eur': 0, 'Credito': 0, other: 0 };
        const counts = {};

        salesList.forEach(s => {
            const method = s.method || 'other';
            const amount = Number(s.totalUSD) || 0;
            if (breakdown[method] !== undefined) {
                breakdown[method] += amount;
            } else {
                breakdown.other += amount;
            }
            counts[method] = (counts[method] || 0) + 1;
        });

        return { totals: breakdown, counts };
    }

    // ──────────────────────────────────────────────
    // 9. RESPALDO Y RESTAURACIÓN
    // ──────────────────────────────────────────────

    /**
     * Exporta todos los datos del sistema como un archivo JSON de respaldo.
     */
    function backupAllData() {
        const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            sales: sales,
            products: products,
            dailyHistory: dailyHistory,
            suppliers: getSuppliers(),
            settings: settings,
            expenses: expenses
        };

        // Intentar incluir clients
        if (typeof clients !== 'undefined') data.clients = clients;

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `respaldo-cajafresh-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);

        Swal.fire({
            icon: 'success',
            title: 'Respaldo Exportado',
            text: `${(blob.size / 1024).toFixed(1)} KB — ${data.sales.length} ventas, ${data.products.length} productos`,
            confirmButtonText: 'OK'
        });
    }

    /**
     * Restaura datos desde un archivo JSON de respaldo.
     */
    function restoreFromBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);

                    if (!data.version || !data.sales || !data.products) {
                        Swal.fire('Error', 'Archivo de respaldo inválido o versión incompatible.', 'error');
                        return;
                    }

                    Swal.fire({
                        title: '¿Restaurar Datos?',
                        html: `
                            <p class="text-sm">Se reemplazarán TODOS los datos actuales:</p>
                            <ul class="text-xs mt-2 text-left space-y-1">
                                <li>📦 ${data.products.length} productos</li>
                                <li>🧾 ${data.sales.length} ventas</li>
                                <li>📊 ${data.dailyHistory?.length || 0} días de historial</li>
                            </ul>
                            <p class="text-xs text-red-500 font-bold mt-3">⚠️ Esta acción no se puede deshacer</p>
                        `,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonColor: '#ef4444',
                        confirmButtonText: 'Sí, restaurar',
                        cancelButtonText: 'Cancelar'
                    }).then(res => {
                        if (!res.isConfirmed) return;

                        // Reemplazar arrays globales
                        sales.length = 0;
                        data.sales.forEach(s => sales.push(s));

                        products.length = 0;
                        data.products.forEach(p => products.push(p));

                        dailyHistory.length = 0;
                        (data.dailyHistory || []).forEach(d => dailyHistory.push(d));

                        if (data.suppliers) saveSuppliers(data.suppliers);

                        // Sobrescribir localStorage
                        saveSales();
                        saveProducts();
                        if (typeof saveHistory === 'function') saveHistory();

                        // Refrescar UI
                        if (typeof renderInventory === 'function') renderInventory();
                        if (typeof renderReports === 'function') renderReports();
                        if (typeof renderAnalytics === 'function') renderAnalytics();

                        Swal.fire({
                            icon: 'success',
                            title: 'Datos Restaurados',
                            text: `${data.products.length} productos, ${data.sales.length} ventas`,
                            confirmButtonText: 'OK'
                        });
                    });

                } catch (err) {
                    Swal.fire('Error', 'No se pudo leer el archivo: ' + err.message, 'error');
                }
            };
            reader.readAsText(file);
            Swal.fire({ title: 'Leyendo archivo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        };
        input.click();
    }

    // ──────────────────────────────────────────────
    // 10. GASTOS CON CATEGORÍA Y EDICIÓN
    // ──────────────────────────────────────────────

    const EXPENSE_CATEGORIES = [
        'Alquiler', 'Electricidad', 'Agua', 'Gas', 'Internet/Telefonía',
        'Salarios', 'Honorarios', 'Transporte/Logística', 'Mantenimiento',
        'Publicidad/Marketing', 'Impuestos', 'Seguros', ' Proveedores',
        'Limpieza', 'Utensilios', 'Reposiciones', 'Otros'
    ];

    /**
     * Renderiza la tabla de gastos con categorías, permitiendo editar.
     * @param {Array} expensesList
     * @param {string} containerId
     */
    function renderExpensesAdvanced(expensesList, containerId) {
        const container = document.getElementById(containerId || 'expenses-table-body');
        if (!container) return;

        if (!expensesList || expensesList.length === 0) {
            container.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-slate-400 italic">No hay gastos registrados</td></tr>';
            return;
        }

        // Ordenar por fecha descendente
        const sorted = [...expensesList].sort((a, b) => new Date(b.date) - new Date(a.date));

        container.innerHTML = sorted.map((e, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="py-3 px-4 text-slate-500 text-xs">${e.date ? new Date(e.date).toLocaleDateString('es-VE') : '-'}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold">${e.category || 'Sin categoría'}</span>
                </td>
                <td class="py-3 px-4 font-medium text-slate-700">${e.description || '-'}</td>
                <td class="py-3 px-4 text-right font-black text-slate-800">${formatUSDshort(e.amountUSD || 0)}</td>
                <td class="py-3 px-4 text-right">
                    <button onclick="POSExtensions.editExpense(${i})" class="text-brand-600 hover:bg-brand-50 p-2 rounded-lg transition-colors" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="POSExtensions.deleteExpenseEntry(${i})" class="text-red-500 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    /**
     * Abre modal para crear o editar gasto con categoría y moneda.
     * @param {number|null} editIndex
     */
    function openExpenseModalAdvanced(editIndex) {
        const existing = (editIndex !== null && editIndex !== undefined && window.expenses) ? window.expenses[editIndex] : null;

        const categoryOptions = EXPENSE_CATEGORIES.map(c =>
            `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`
        ).join('');

        Swal.fire({
            title: existing ? 'Editar Gasto' : 'Nuevo Gasto',
            html: `
                <select id="exp-category" class="swal2-input" style="height:auto; padding:10px">
                    <option value="">Seleccionar categoría...</option>
                    ${categoryOptions}
                </select>
                <input id="exp-desc" class="swal2-input" placeholder="Descripción del gasto" value="${existing?.description || ''}">
                <div class="flex gap-2">
                    <input id="exp-amount" type="number" step="0.01" min="0" class="swal2-input" placeholder="0.00" style="width:65%; display:inline-block" value="${existing?.amountUSD || ''}">
                    <select id="exp-currency" class="swal2-input" style="width:30%; display:inline-block; height:auto; padding:10px">
                        <option value="USD" ${existing?.currency === 'VES' ? '' : 'selected'}>USD</option>
                        <option value="VES" ${existing?.currency === 'VES' ? 'selected' : ''}>VES</option>
                    </select>
                </div>
                <label class="flex items-center gap-2 mt-2 text-sm text-slate-600">
                    <input type="checkbox" id="exp-recurring" ${existing?.isRecurring ? 'checked' : ''}>
                    Gasto recurrente (se copia cada mes)
                </label>
                <input id="exp-date" type="date" class="swal2-input" value="${existing?.date ? existing.date.slice(0, 10) : new Date().toISOString().slice(0, 10)}">
            `,
            showCancelButton: true,
            confirmButtonText: existing ? 'Guardar Cambios' : 'Agregar Gasto',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const category = document.getElementById('exp-category').value;
                const description = document.getElementById('exp-desc').value.trim();
                const amount = parseFloat(document.getElementById('exp-amount').value);
                const currency = document.getElementById('exp-currency').value;
                const isRecurring = document.getElementById('exp-recurring').checked;
                const date = document.getElementById('exp-date').value;

                if (!description) {
                    Swal.showValidationMessage('La descripción es obligatoria');
                    return;
                }
                if (isNaN(amount) || amount <= 0) {
                    Swal.showValidationMessage('Ingresa un monto válido mayor a 0');
                    return;
                }

                const amountUSD = currency === 'VES' && settings?.exchangeRate
                    ? amount / Number(settings.exchangeRate)
                    : amount;

                return {
                    id: existing?.id || 'exp_' + Date.now(),
                    date: date ? new Date(date).toISOString() : new Date().toISOString(),
                    category: category || 'Otros',
                    description: description,
                    amount: amount,
                    amountUSD: amountUSD,
                    currency: currency,
                    isRecurring: isRecurring,
                    updatedAt: new Date().toISOString()
                };
            }
        }).then(res => {
            if (!res.isConfirmed) return;

            if (existing) {
                window.expenses[editIndex] = res.value;
            } else {
                window.expenses.push(res.value);
            }
            if (typeof saveExpenses === 'function') saveExpenses();
            renderExpensesAdvanced(window.expenses);
            Swal.fire({
                icon: 'success',
                title: existing ? 'Gasto Actualizado' : 'Gasto Registrado',
                timer: 1500,
                showConfirmButton: false
            });
        });
    }

    function editExpense(index) {
        openExpenseModalAdvanced(index);
    }

    function deleteExpenseEntry(index) {
        Swal.fire({
            title: '¿Eliminar Gasto?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar'
        }).then(res => {
            if (res.isConfirmed) {
                window.expenses.splice(index, 1);
                if (typeof saveExpenses === 'function') saveExpenses();
                renderExpensesAdvanced(window.expenses);
                Swal.fire('Eliminado', '', 'success');
            }
        });
    }

    /**
     * Procesa gastos recurrentes: copia al mes actual los que ya existían en meses anteriores.
     */
    function processRecurringExpenses() {
        if (typeof window.expenses === 'undefined') return;
        const thisMonth = new Date().getMonth();
        const thisYear = new Date().getFullYear();

        const recurring = window.expenses.filter(e => e.isRecurring);
        let added = 0;

        recurring.forEach(e => {
            const expDate = new Date(e.date);
            const expMonth = expDate.getMonth();
            const expYear = expDate.getFullYear();

            // Si el gasto recurrente es de un mes anterior y no existe copia este mes
            if (expYear < thisYear || (expYear === thisYear && expMonth < thisMonth)) {
                const existsThisMonth = window.expenses.some(ex =>
                    ex.description === e.description &&
                    ex.amountUSD === e.amountUSD &&
                    ex.category === e.category &&
                    new Date(ex.date).getMonth() === thisMonth &&
                    new Date(ex.date).getFullYear() === thisYear
                );

                if (!existsThisMonth) {
                    window.expenses.push({
                        id: 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                        date: new Date(thisYear, thisMonth, 1).toISOString(),
                        category: e.category || 'Otros',
                        description: e.description + ' (Recurrente)',
                        amount: e.amount,
                        amountUSD: e.amountUSD,
                        currency: e.currency || 'USD',
                        isRecurring: true,
                        updatedAt: new Date().toISOString()
                    });
                    added++;
                }
            }
        });

        if (added > 0) {
            if (typeof saveExpenses === 'function') saveExpenses();
        }
    }

    // ──────────────────────────────────────────────
    // 11. CRÉDITOS: HISTORIAL DE PAGOS E INTERESES
    // ──────────────────────────────────────────────

    const CREDIT_PAYMENTS_KEY = 'freshpos_credit_payments';

    function getCreditPayments() {
        const raw = localStorage.getItem(CREDIT_PAYMENTS_KEY);
        return raw ? safeJSONParse(raw) : [];
    }

    function saveCreditPayments(payments) {
        localStorage.setItem(CREDIT_PAYMENTS_KEY, JSON.stringify(payments));
    }

    /**
     * Registra un abono a crédito con historial persistente.
     * @param {string} saleId - ID de la venta a abonar
     * @param {number} amount - Monto del abono
     * @returns {boolean}
     */
    function recordCreditPayment(saleId, amount) {
        const sale = sales.find(s => s.id === saleId || s.ticket === saleId);
        if (!sale) return false;

        const payments = getCreditPayments();
        payments.push({
            id: 'cp_' + Date.now(),
            saleId: sale.id || sale.ticket,
            ticket: sale.ticket || sale.id,
            clientName: sale.client?.name || 'Desconocido',
            amount: Number(amount) || 0,
            previousBalance: Number(sale.totalUSD) || 0,
            remaining: Math.max(0, (Number(sale.totalUSD) || 0) - (Number(amount) || 0)),
            date: new Date().toISOString(),
            method: 'cash-usd'
        });
        saveCreditPayments(payments);

        // Si queda saldo 0 o menor, marcar como pagado
        const remaining = (Number(sale.totalUSD) || 0) - (Number(amount) || 0);
        if (remaining <= 0) {
            sale.status = 'paid';
            saveSales();
        }

        // Auditoría
        if (typeof logAction === 'function') {
            logAction('CREDIT_PAYMENT', `Abono de ${formatUSDshort(amount)} a crédito #${sale.ticket || sale.id}`, { client: sale.client?.name, amount });
        }

        return true;
    }

    /**
     * Renderiza historial de pagos de un crédito específico.
     * @param {string} saleId
     */
    function showCreditPaymentHistory(saleId) {
        const payments = getCreditPayments().filter(p => p.saleId === saleId || p.ticket === saleId);
        const sale = sales.find(s => s.id === saleId || s.ticket === saleId);

        if (payments.length === 0) {
            Swal.fire('Sin pagos', 'Este crédito no tiene abonos registrados.', 'info');
            return;
        }

        const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

        Swal.fire({
            title: `Abonos — #${sale?.ticket || saleId}`,
            width: 500,
            html: `
                <div class="text-left">
                    <div class="grid grid-cols-2 gap-3 mb-4">
                        <div class="bg-slate-50 p-3 rounded-xl">
                            <p class="text-[10px] text-slate-400 font-bold uppercase">Total Abonado</p>
                            <p class="text-xl font-black text-emerald-600">${formatUSDshort(totalPaid)}</p>
                        </div>
                        <div class="bg-slate-50 p-3 rounded-xl">
                            <p class="text-[10px] text-slate-400 font-bold uppercase">Pendiente</p>
                            <p class="text-xl font-black text-red-600">${formatUSDshort(Math.max(0, (Number(sale?.totalUSD) || 0) - totalPaid))}</p>
                        </div>
                    </div>
                    <table class="w-full text-left text-sm">
                        <thead><tr class="text-[10px] text-slate-400 uppercase font-bold">
                            <th class="pb-2">Fecha</th>
                            <th class="pb-2 text-right">Monto</th>
                            <th class="pb-2 text-right">Saldo Restante</th>
                        </tr></thead>
                        <tbody>
                            ${payments.sort((a, b) => new Date(b.date) - new Date(a.date)).map(p => `
                                <tr class="border-t border-slate-50">
                                    <td class="py-2 text-slate-500">${new Date(p.date).toLocaleDateString('es-VE')}</td>
                                    <td class="py-2 text-right font-bold text-emerald-600">${formatUSDshort(p.amount)}</td>
                                    <td class="py-2 text-right text-slate-600">${formatUSDshort(p.remaining)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `,
            confirmButtonText: 'Cerrar'
        });
    }

    /**
     * Extiende la función existente settleCredit para registrar pagos con historial.
     */
    function settleCreditWithHistory(creditId, maxAmount) {
        Swal.fire({
            title: 'Registrar Abono',
            html: `
                <input id="swal-abono-monto" type="number" step="0.01" min="0" max="${maxAmount}" class="swal2-input" placeholder="Monto en USD">
                <p class="text-xs text-slate-400 mt-1">Máximo: ${formatUSDshort(maxAmount)}</p>
            `,
            showCancelButton: true,
            confirmButtonText: 'Registrar Abono',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const amount = parseFloat(document.getElementById('swal-abono-monto').value);
                if (isNaN(amount) || amount <= 0) {
                    Swal.showValidationMessage('Ingresa un monto válido');
                    return;
                }
                return amount;
            }
        }).then(res => {
            if (!res.isConfirmed) return;
            const amount = Math.min(res.value, maxAmount);
            recordCreditPayment(creditId, amount);
            if (typeof renderCredits === 'function') renderCredits();
            Swal.fire({
                icon: 'success',
                title: 'Abono Registrado',
                text: `${formatUSDshort(amount)} abonados al crédito`,
                timer: 2000,
                showConfirmButton: false
            });
        });
    }

    /**
     * Calcula interés por mora sobre créditos vencidos.
     * @param {number} daysOverdue - Días de vencimiento
     * @param {number} amount - Monto adeudado
     * @param {number} monthlyRate - Tasa de interés mensual (ej: 5 = 5%)
     * @returns {number} Interés calculado
     */
    function calculateLateInterest(daysOverdue, amount, monthlyRate) {
        if (daysOverdue <= 0 || amount <= 0) return 0;
        const dailyRate = (monthlyRate || 5) / 30 / 100;
        return amount * dailyRate * daysOverdue;
    }

    // ──────────────────────────────────────────────
    // 12. FILTRO DE AUDITORÍA
    // ──────────────────────────────────────────────

    /**
     * Renderiza logs de auditoría con filtros por tipo y fecha.
     * @param {Array} logs
     * @param {string} containerId
     * @param {Object} filters - { type, startDate, endDate }
     */
    function renderAuditLogsFiltered(logs, containerId, filters) {
        const container = document.getElementById(containerId || 'audit-table-body');
        if (!container) return;

        let filtered = [...logs];

        if (filters?.type) {
            filtered = filtered.filter(l => l.type === filters.type);
        }
        if (filters?.startDate) {
            const start = new Date(filters.startDate + 'T00:00:00');
            filtered = filtered.filter(l => new Date(l.timestamp || l.date) >= start);
        }
        if (filters?.endDate) {
            const end = new Date(filters.endDate + 'T23:59:59');
            filtered = filtered.filter(l => new Date(l.timestamp || l.date) <= end);
        }

        filtered.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));

        if (filtered.length === 0) {
            container.innerHTML = `<tr><td colspan="4" class="py-20 text-center text-slate-400 font-medium italic">No hay registros con esos filtros</td></tr>`;
            return;
        }

        const typeColors = {
            'SALE_COMPLETE': 'text-emerald-600 bg-emerald-50',
            'SALE_VOID': 'text-red-600 bg-red-50',
            'PRODUCT_CREATE': 'text-blue-600 bg-blue-50',
            'PRODUCT_UPDATE': 'text-indigo-600 bg-indigo-50',
            'STOCK_ADJUST': 'text-amber-600 bg-amber-50',
            'CREDIT_PAYMENT': 'text-purple-600 bg-purple-50',
            'EXPENSE_CREATE': 'text-rose-600 bg-rose-50'
        };

        container.innerHTML = filtered.map(l => {
            const colorClass = typeColors[l.type] || 'text-slate-600 bg-slate-50';
            const date = new Date(l.timestamp || l.date).toLocaleString('es-VE', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
            });

            return `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="py-3 px-4 text-xs text-slate-400">${date}</td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${colorClass}">${l.type}</span>
                    </td>
                    <td class="py-3 px-4 text-sm text-slate-700">${l.description || '-'}</td>
                    <td class="py-3 px-4 text-xs text-slate-400">${l.role || 'cajero'}</td>
                </tr>
            `;
        }).join('');
    }

    // ──────────────────────────────────────────────
    // 13. HISTORIAL DE COMPRAS A PROVEEDORES
    // ──────────────────────────────────────────────

    const PURCHASE_HISTORY_KEY = 'freshpos_purchase_history';

    function getPurchaseHistory() {
        const raw = localStorage.getItem(PURCHASE_HISTORY_KEY);
        return raw ? safeJSONParse(raw) : [];
    }

    /**
     * Registra una compra en el historial (debe llamarse desde el flujo de compras).
     * @param {Object} purchaseData - { supplier, items, totalCost, invoiceRef }
     */
    function recordPurchase(purchaseData) {
        const history = getPurchaseHistory();
        history.push({
            id: 'pur_' + Date.now(),
            date: new Date().toISOString(),
            supplier: purchaseData.supplier || 'Proveedor no registrado',
            items: purchaseData.items || [],
            totalCost: Number(purchaseData.totalCost) || 0,
            invoiceRef: purchaseData.invoiceRef || '',
            notes: purchaseData.notes || '',
            paymentMethod: purchaseData.paymentMethod || 'cash-usd'
        });

        // Mantener máximo 200 registros
        if (history.length > 200) history.splice(0, history.length - 200);
        localStorage.setItem(PURCHASE_HISTORY_KEY, JSON.stringify(history));

        if (typeof logAction === 'function') {
            logAction('PURCHASE_RECORD', `Compra registrada: ${purchaseData.supplier} por ${formatUSDshort(purchaseData.totalCost)}`, { invoiceRef: purchaseData.invoiceRef });
        }

        return history;
    }

    /**
     * Renderiza historial de compras.
     */
    function renderPurchaseHistory(containerId) {
        const container = document.getElementById(containerId || 'purchase-history-body');
        if (!container) return;

        const history = getPurchaseHistory();
        if (history.length === 0) {
            container.innerHTML = '<tr><td colspan="4" class="py-10 text-center text-slate-400 italic">No hay compras registradas</td></tr>';
            return;
        }

        const sorted = [...history].sort((a, b) => new Date(b.date) - new Date(a.date));

        container.innerHTML = sorted.map(p => `
            <tr class="hover:bg-slate-50 border-b border-slate-100">
                <td class="py-3 px-4 text-xs text-slate-500">${new Date(p.date).toLocaleDateString('es-VE')}</td>
                <td class="py-3 px-4 font-bold text-slate-700">${p.supplier}</td>
                <td class="py-3 px-4 text-sm text-slate-500">${p.items?.length || 0} productos</td>
                <td class="py-3 px-4 text-right font-black text-slate-800">${formatUSDshort(p.totalCost)}</td>
                <td class="py-3 px-4 text-xs text-slate-400">${p.invoiceRef || '-'}</td>
            </tr>
        `).join('');
    }

    // ──────────────────────────────────────────────
    // 14. BARCODE / SCANNER
    // ──────────────────────────────────────────────

    let barcodeScannerActive = false;
    let barcodeScanBuffer = '';
    let barcodeScanTimer = null;

    /**
     * Activa el escáner de código de barras por teclado (buffer).
     * Similar al existente en app.js pero configurable.
     * @param {number} timeout - ms entre caracteres para considerar nuevo código
     */
    function activateBarcodeScanner(timeout) {
        if (barcodeScannerActive) return;
        barcodeScannerActive = true;

        document.addEventListener('keydown', function barcodeHandler(e) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            if (e.key === 'Enter' && barcodeScanBuffer.length > 3) {
                const code = barcodeScanBuffer;
                barcodeScanBuffer = '';

                // Buscar producto por código de barras
                const product = products.find(p => p.barcode && p.barcode.trim() === code.trim());
                if (product) {
                    if (typeof addToCart === 'function') {
                        addToCart(product);
                    }
                } else {
                    // Intentar búsqueda parcial
                    const partial = products.find(p => p.barcode && p.barcode.includes(code.trim()));
                    if (partial) {
                        if (typeof addToCart === 'function') addToCart(partial);
                    }
                }
                return;
            }

            if (e.key.length === 1) {
                barcodeScanBuffer += e.key;
                clearTimeout(barcodeScanTimer);
                barcodeScanTimer = setTimeout(() => { barcodeScanBuffer = ''; }, timeout || 100);
            }
        });
    }

    // ──────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────

    function formatUSDshort(n) {
        return '$' + (Number(n) || 0).toFixed(2);
    }

    function safeJSONParse(str) {
        try { return JSON.parse(str); } catch (e) { return {}; }
    }

    // ──────────────────────────────────────────────
    // API PÚBLICA
    // ──────────────────────────────────────────────
    /**
     * Abre modal de anulación para un ticket específico (desde botón en tabla).
     */
    return {

        // Dashboard
        renderDashboard,

        // Anulaciones y devoluciones
        voidSale,
        openVoidSaleModal,

        // Ajuste de stock
        adjustStock,
        openStockAdjustModal,

        // Proveedores
        getSuppliers,
        saveSuppliers,
        renderSuppliers,
        openSupplierModal,
        editSupplier,
        deleteSupplier,

        // Historial de clientes
        showClientHistory,

        // Importar/Exportar inventario
        exportInventoryCSV,
        importInventoryCSV,
        openImportCSVDialog,

        // Reportes
        filterSalesByDateRange,
        paymentMethodBreakdown,

        // Respaldo
        backupAllData,
        restoreFromBackup,

        // Gastos avanzados
        renderExpensesAdvanced,
        openExpenseModalAdvanced,
        editExpense,
        deleteExpenseEntry,
        processRecurringExpenses,
        EXPENSE_CATEGORIES,

        // Créditos
        recordCreditPayment,
        showCreditPaymentHistory,
        settleCreditWithHistory,
        calculateLateInterest,
        getCreditPayments,

        // Auditoría
        renderAuditLogsFiltered,

        // Compras / Historial
        getPurchaseHistory,
        recordPurchase,
        renderPurchaseHistory,

        // Barcode scanner
        activateBarcodeScanner
    };

})();
