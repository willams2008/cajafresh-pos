/**
 * Tests unitarios para Gestión de Clientes, Créditos y Documentos
 */

describe('Clients & Credit Management', () => {
    function isValidVenezuelanDoc(doc) {
        if (!doc || typeof doc !== 'string') return false;
        const cleaned = doc.trim().toUpperCase();
        // V-12345678, J-12345678-0, E-12345678, G-12345678-0
        return /^[VJEG]-?\d{5,9}(-\d)?$/.test(cleaned);
    }

    function calculateClientBalance(credits = []) {
        return credits.reduce((acc, c) => {
            if (c.status === 'PENDING' || c.status === 'PARTIAL') {
                return acc + ((c.amountUSD || 0) - (c.paidUSD || 0));
            }
            return acc;
        }, 0);
    }

    test('valida formatos de cédula y RIF venezolanos', () => {
        expect(isValidVenezuelanDoc('V-12345678')).toBe(true);
        expect(isValidVenezuelanDoc('V12345678')).toBe(true);
        expect(isValidVenezuelanDoc('J-31445678-0')).toBe(true);
        expect(isValidVenezuelanDoc('E-84123456')).toBe(true);
        expect(isValidVenezuelanDoc('G-20001234-5')).toBe(true);
        expect(isValidVenezuelanDoc('')).toBe(false);
        expect(isValidVenezuelanDoc('12345')).toBe(false);
        expect(isValidVenezuelanDoc('INVALIDO')).toBe(false);
    });

    test('calcula balance pendiente de créditos correctamente', () => {
        const credits = [
            { id: 'c1', amountUSD: 50, paidUSD: 20, status: 'PARTIAL' }, // resta 30
            { id: 'c2', amountUSD: 40, paidUSD: 40, status: 'PAID' },    // resta 0
            { id: 'c3', amountUSD: 25, paidUSD: 0,  status: 'PENDING' }, // resta 25
        ];

        const pending = calculateClientBalance(credits);
        expect(pending).toBe(55);
    });

    test('acumula puntos de fidelidad (loyalty points)', () => {
        const pointsRatio = 1; // 1 punto por cada $10 gastados
        function getEarnedPoints(saleTotalUSD) {
            return Math.floor(saleTotalUSD / 10) * pointsRatio;
        }

        expect(getEarnedPoints(9.99)).toBe(0);
        expect(getEarnedPoints(10.00)).toBe(1);
        expect(getEarnedPoints(45.50)).toBe(4);
        expect(getEarnedPoints(100.00)).toBe(10);
    });
});
