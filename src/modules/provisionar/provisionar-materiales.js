/**
 * provisionar-materiales.js - Modulo UI de Materiales
 * Gestiona formulario, tabla de inventario y notifica cambios via CustomEvent
 */
(function() {
    var $form = null;
    var $tablaBody = null;

    window.ProvisionarMateriales = {
        async init() {
            $form = document.getElementById('form-material');
            $tablaBody = document.getElementById('tabla-materiales-body');

            this.bindEvents();
            await this.cargarYRenderizar();
        },

        bindEvents() {
            if ($form) {
                $form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    await this.guardar();
                });
            }

            if ($tablaBody) {
                $tablaBody.addEventListener('click', async (e) => {
                    var btnEliminar = e.target.closest('.btn-eliminar-material');
                    if (btnEliminar) {
                        var id = btnEliminar.dataset.id;
                        if (confirm('Eliminar este material del inventario?')) {
                            await window.ProvisionarDB.eliminarMaterial(id);
                            await this.cargarYRenderizar();
                        }
                    }
                });
            }
        },

        async cargarYRenderizar() {
            var lista = await window.ProvisionarDB.obtenerMateriales();
            this.renderTabla(lista);

            document.dispatchEvent(new CustomEvent('provisionar:materiales-actualizados', {
                detail: { materiales: lista }
            }));
        },

        async guardar() {
            var materialData = {
                id: document.getElementById('mat-id') ? document.getElementById('mat-id').value : null,
                nombre: document.getElementById('mat-nombre').value,
                tipo: document.getElementById('mat-tipo').value,
                ancho: parseFloat(document.getElementById('mat-ancho').value) || 0,
                largo: parseFloat(document.getElementById('mat-largo').value) || 0,
                espesor: parseFloat(document.getElementById('mat-espesor').value) || 0,
                precio: parseFloat(document.getElementById('mat-precio').value) || 0
            };

            await window.ProvisionarDB.guardarMaterial(materialData);
            if ($form) $form.reset();

            var matIdInput = document.getElementById('mat-id');
            if (matIdInput) matIdInput.value = '';

            await this.cargarYRenderizar();
        },

        renderTabla(materiales) {
            if (!$tablaBody) return;

            if (materiales.length === 0) {
                $tablaBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay materiales registrados.</td></tr>';
                return;
            }

            var html = '';
            for (var i = 0; i < materiales.length; i++) {
                var m = materiales[i];
                html += '<tr>' +
                    '<td><strong>' + m.nombre + '</strong></td>' +
                    '<td><span class="badge">' + m.tipo + '</span></td>' +
                    '<td>' + m.ancho + ' x ' + m.largo + ' mm</td>' +
                    '<td>' + m.espesor + ' mm</td>' +
                    '<td>$' + m.precio.toFixed(2) + '</td>' +
                    '<td><button class="btn-eliminar-material btn-danger btn-sm" data-id="' + m.id + '">X</button></td>' +
                    '</tr>';
            }
            $tablaBody.innerHTML = html;
        }
    };
})();
