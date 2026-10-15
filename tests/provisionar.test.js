/**
 * Tests unitarios para el módulo de Provisionar (Corte Láser & Materiales)
 */

describe('Provisionar Module — Laser Cutting & Acrylics', () => {
    const rawMateriales = [
        { id: 'mat_acr_trans_ent',  nombre: 'Acrílico Transparente Entera',  largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 55,  stock: 10 },
        { id: 'mat_acr_trans_18',   nombre: 'Acrílico Transparente 1/8',     largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 12,  stock: 20 },
        { id: 'mat_acr_trans_14',   nombre: 'Acrílico Transparente 1/4',     largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 22,  stock: 15 },
        { id: 'mat_acr_trans_12',   nombre: 'Acrílico Transparente 1/2',     largo: 600,  ancho: 400, espesor: 12, costoPlancha: 35,  stock: 10 },
        { id: 'mat_acr_col_ent',    nombre: 'Acrílico Color Entera',         largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 85,  stock: 8  },
        { id: 'mat_acr_col_18',     nombre: 'Acrílico Color 1/8',            largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 15,  stock: 15 },
        { id: 'mat_acr_col_14',     nombre: 'Acrílico Color 1/4',            largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 25,  stock: 12 },
        { id: 'mat_acr_col_12',     nombre: 'Acrílico Color 1/2',            largo: 600,  ancho: 400, espesor: 12, costoPlancha: 45,  stock: 8  },
        { id: 'mat_acr_esp_ent',    nombre: 'Acrílico Espejo Entera',        largo: 1220, ancho: 610, espesor: 3,  costoPlancha: 100, stock: 5  },
        { id: 'mat_acr_esp_18',     nombre: 'Acrílico Espejo 1/8',           largo: 600,  ancho: 400, espesor: 3,  costoPlancha: 20,  stock: 10 },
        { id: 'mat_acr_esp_14',     nombre: 'Acrílico Espejo 1/4',           largo: 600,  ancho: 400, espesor: 6,  costoPlancha: 35,  stock: 8  },
        { id: 'mat_acr_esp_med',    nombre: 'Acrílico Espejo Media',         largo: 600,  ancho: 610, espesor: 12, costoPlancha: 55,  stock: 6  },
    ];

    test('contiene exactamente los 12 productos estándar de acrílico', () => {
        expect(rawMateriales).toHaveLength(12);
        const ids = rawMateriales.map(m => m.id);
        expect(ids).toContain('mat_acr_trans_ent');
        expect(ids).toContain('mat_acr_col_ent');
        expect(ids).toContain('mat_acr_esp_ent');
        expect(ids).toContain('mat_acr_esp_med');
    });

    test('calcula precio sugerido al POS con 30% de margen', () => {
        const rate = 36.5;
        const sincronizados = rawMateriales.map(m => {
            const costo = m.costoPlancha;
            const precioUSD = parseFloat((costo * 1.3).toFixed(2));
            const precioVES = Math.round(precioUSD * rate / 10) * 10;
            return {
                id: m.id,
                name: m.nombre,
                costPrice: costo,
                priceUSD: precioUSD,
                priceVES: precioVES,
                stock: m.stock,
            };
        });

        // Verificación de Acrílico Transparente Entera: costo 55 -> precioUSD 71.50
        const transEnt = sincronizados.find(p => p.id === 'mat_acr_trans_ent');
        expect(transEnt.priceUSD).toBe(71.50);
        expect(transEnt.costPrice).toBe(55);
        expect(transEnt.stock).toBe(10);
        expect(transEnt.priceVES).toBe(Math.round(71.50 * rate / 10) * 10);
    });

    test('calcula cotización de pieza con desperdicio y costo de máquina', () => {
        // Pieza de 300x200mm en plancha de 600x400 (1/8)
        const areaPlanchaMm2 = 600 * 400; // 240,000 mm2
        const areaPiezaMm2 = 300 * 200;   // 60,000 mm2
        const fraccionPlancha = areaPiezaMm2 / areaPlanchaMm2; // 0.25 (25%)

        const costoPlancha = 12.00; // $12
        const costoMaterialPieza = costoPlancha * fraccionPlancha; // $3.00

        const tiempoCorteSegundos = 45; // 45s de corte
        const costoPorMinutoLaser = 0.50; // $0.50 / min
        const costoCorteLaser = (tiempoCorteSegundos / 60) * costoPorMinutoLaser; // 0.375

        const costoTotal = costoMaterialPieza + costoCorteLaser;
        const margenDeseado = 0.35; // 35%
        const precioCotizado = parseFloat((costoTotal * (1 + margenDeseado)).toFixed(2));

        expect(costoMaterialPieza).toBe(3.00);
        expect(costoCorteLaser).toBe(0.375);
        expect(precioCotizado).toBe(4.56);
    });

    test('valida dimensiones para nesting en plancha', () => {
        const plancha = { width: 1220, height: 610 };
        const piezaValida = { width: 400, height: 200 };
        const piezaMuyGrande = { width: 1300, height: 500 };

        function cabeEnPlancha(pieza, p) {
            const normal = pieza.width <= p.width && pieza.height <= p.height;
            const rotada = pieza.height <= p.width && pieza.width <= p.height;
            return normal || rotada;
        }

        expect(cabeEnPlancha(piezaValida, plancha)).toBe(true);
        expect(cabeEnPlancha(piezaMuyGrande, plancha)).toBe(false);
    });
});
