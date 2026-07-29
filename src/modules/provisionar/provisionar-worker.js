/**
 * provisionar-worker.js — Algoritmo de Nesting en Hilo Secundario
 * Compatible con la estructura de datos de src/features/provisionar.js
 *
 * Entrada (postMessage):
 *   {
 *     materialIds: string[],
 *     piezasPorMaterial: { [matId]: [{ w, h, label, originalW, originalH }] },
 *     materialesMap: { [matId]: { id, nombre, largo, ancho, costoM2, costoPlancha, color, ... } },
 *     kerf: number,
 *     costoHora: number
 *   }
 *
 * Salida (postMessage):
 *   { nestingResultados, activeNestingMaterialId }
 */

self.onmessage = function(e) {
    var data = e.data;
    try {
        var resultado = procesarNesting(
            data.materialIds,
            data.piezasPorMaterial,
            data.materialesMap,
            data.kerf || 0,
            data.costoHora || 0
        );
        self.postMessage({ ok: true, resultado: resultado });
    } catch (err) {
        self.postMessage({ ok: false, error: err.message });
    }
};

/**
 * Procesa el nesting multi-material con algoritmo Guillotine (Shelf) + Rotación.
 * Reproduce exactamente la lógica de optimizarCortes() en provisionar.js
 * pero en un hilo separado.
 */
function procesarNesting(materialIds, piezasPorMaterial, materialesMap, kerf, costoHora) {
    var nestingResultados = {};

    materialIds.forEach(function(matId) {
        var mat = materialesMap[matId];
        if (!mat) return;
        var laminaX = mat.largo;
        var laminaY = mat.ancho;
        var piezasACortar = piezasPorMaterial[matId];

        // Ordenar por área descendente (mejora el empaquetado)
        piezasACortar.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

        var cutoutH = mat.cutoutH || 0; // extensión horizontal del cutout (largo)
        var cutoutW = mat.cutoutW || 0; // extensión vertical del cutout (ancho)

        var startX = function(y) { return y < cutoutW ? cutoutH : 0; };
        var widthAvail = function(y) { return y < cutoutW ? Math.max(0, laminaX - cutoutH) : laminaX; };

        // ── Algoritmo Guillotine (Shelf) con Rotación inteligente y soporte L-Shape ──
        var planchas = [];
        var planchaActual = [];
        var currentY = 0;
        var currentX = startX(currentY);
        var espacioRestanteX = widthAvail(currentY);
        var espacioRestanteY = laminaY;
        var rowHeight = 0;

        function crearPiezaColocada(x, y, w, h, pieza, labelSuffix) {
            return {
                x: x,
                y: y,
                w: w,
                h: h,
                label: pieza.label + (labelSuffix ? (' ' + labelSuffix) : ''),
                shapeType: pieza.shapeType,
                vertices: pieza.vertices,
                pathD: pieza.pathD,
                bboxX: pieza.bboxX,
                bboxY: pieza.bboxY,
                bboxW: pieza.bboxW,
                bboxH: pieza.bboxH,
                originalW: pieza.originalW,
                originalH: pieza.originalH,
                entities: pieza.entities,
                minX: pieza.minX,
                minY: pieza.minY
            };
        }

        piezasACortar.forEach(function(pieza) {
            var w = pieza.w;
            var h = pieza.h;
            var originalW = pieza.originalW;
            var originalH = pieza.originalH;

            // Intentar colocar en fila actual
            if (w <= espacioRestanteX && h <= espacioRestanteY) {
                planchaActual.push(crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, ''));
                currentX += w;
                espacioRestanteX -= w;
                rowHeight = Math.max(rowHeight, h);
            } else if (h <= espacioRestanteX && w <= espacioRestanteY) {
                // Rotada en fila actual
                planchaActual.push(crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)'));
                currentX += h;
                espacioRestanteX -= h;
                rowHeight = Math.max(rowHeight, w);
            } else {
                // Nueva fila en la misma plancha
                currentY += rowHeight;
                espacioRestanteY -= rowHeight;
                currentX = startX(currentY);
                espacioRestanteX = widthAvail(currentY);
                rowHeight = 0;

                var maxWRow = widthAvail(currentY);
                if (w <= maxWRow && h <= espacioRestanteY) {
                    planchaActual.push(crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, ''));
                    currentX += w;
                    espacioRestanteX -= w;
                    rowHeight = Math.max(rowHeight, h);
                } else if (h <= maxWRow && w <= espacioRestanteY) {
                    planchaActual.push(crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)'));
                    currentX += h;
                    espacioRestanteX -= h;
                    rowHeight = Math.max(rowHeight, w);
                } else {
                    // Nueva plancha
                    if (planchaActual.length) planchas.push(planchaActual);
                    currentY = 0;
                    currentX = startX(currentY);
                    espacioRestanteX = widthAvail(currentY);
                    espacioRestanteY = laminaY;
                    rowHeight = 0;

                    if (w <= maxWRow && h <= laminaY) {
                        planchaActual = [crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, '')];
                        currentX += w;
                        espacioRestanteX -= w;
                        rowHeight = Math.max(rowHeight, h);
                    } else if (h <= maxWRow && w <= laminaY) {
                        planchaActual = [crearPiezaColocada(currentX, currentY, originalH, originalW, pieza, '(Rotada)')];
                        currentX += h;
                        espacioRestanteX -= h;
                        rowHeight = Math.max(rowHeight, w);
                    } else {
                        var pNoCabe = crearPiezaColocada(currentX, currentY, originalW, originalH, pieza, '');
                        pNoCabe.noCabe = true;
                        planchaActual = [pNoCabe];
                    }
                }
            }
        });

        if (planchaActual.length) planchas.push(planchaActual);

        // ── Calcular métricas ──
        var totalPiezas = piezasACortar.length;
        var totalPlanchas = planchas.length;
        var areaTotalPlancha = (cutoutW > 0 && cutoutH > 0)
            ? ((laminaX * laminaY) - (cutoutW * cutoutH))
            : (laminaX * laminaY);
        var areaUsadaTotal = 0;

        var planchasDetalle = planchas.map(function(p, idx) {
            var areaUsada = p.reduce(function(sum, piece) { return sum + (piece.w * piece.h); }, 0);
            areaUsadaTotal += areaUsada;
            return {
                index: idx + 1,
                piezas: p,
                areaUsada: areaUsada,
                areaTotal: areaTotalPlancha,
                desperdicio: areaTotalPlancha - areaUsada,
                usoPct: (areaUsada / areaTotalPlancha * 100)
            };
        });

        var usoTotalPct = totalPlanchas > 0
            ? (areaUsadaTotal / (totalPlanchas * areaTotalPlancha)) * 100
            : 0;

        // ── Tiempo y costo operativo ──
        var perimetroTotal = 0;
        planchas.forEach(function(p) {
            p.forEach(function(piece) {
                perimetroTotal += 2 * (piece.w + piece.h);
            });
        });
        var tiempoCorteSeg = (perimetroTotal / 20) + (totalPlanchas * 5);
        var costoOperativo = (tiempoCorteSeg / 3600) * costoHora;

        nestingResultados[matId] = {
            material: mat,
            planchas: planchasDetalle,
            totalPiezas: totalPiezas,
            totalPlanchas: totalPlanchas,
            areaUsadaTotal: areaUsadaTotal,
            usoPct: usoTotalPct,
            desperdicioPct: 100 - usoTotalPct,
            costoOperativo: costoOperativo
        };
    });

    return {
        nestingResultados: nestingResultados,
        activeNestingMaterialId: materialIds[0] || null
    };
}
