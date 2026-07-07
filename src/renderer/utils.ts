/**
 * Utilidades generales para el frontend del POS.
 * Versión TypeScript.
 */

// ─── Interfaces ────────────────────────────────────────────────

export interface Product {
    id: string;
    name: string;
    category?: string;
    priceUSD?: number;
    priceVES?: number;
    priceEUR?: number;
    costPrice?: number;
    stock?: number;
    minStock?: number;
    barcode?: string;
    sku?: string;
    img?: string;
    [key: string]: unknown;
}

export interface CartItem {
    id: string;
    sku?: string;
    name: string;
    price: number;
    priceVES?: number;
    qty: number;
    img?: string;
    category?: string;
    tax_code?: string;
}

export interface PaymentInfo {
    bank: string;
    amount: number;
    reference: string;
    rawText: string;
}

// ─── Funciones ─────────────────────────────────────────────────

/**
 * Genera un ID único basado en timestamp + random.
 */
export function uid(prefix = ''): string {
    return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Formatea número como moneda (string con 2 decimales).
 */
export function formatMoney(amount: number | null | undefined, decimals = 2): string {
    return Number(amount || 0).toFixed(decimals);
}

/**
 * Parseo seguro de JSON.
 */
export function safeParse<T>(json: string | null | undefined, fallback: T): T {
    try {
        return JSON.parse(json || '') || fallback;
    } catch {
        return fallback;
    }
}

/**
 * Clona un objeto/array de forma segura.
 */
export function deepClone<T>(obj: T): T {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch {
        return obj;
    }
}

/**
 * Agrupa un array por una key.
 */
export function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T[]> {
    return arr.reduce<Record<string, T[]>>((acc, item) => {
        const k = String(item[key]);
        if (!acc[k]) acc[k] = [];
        acc[k].push(item);
        return acc;
    }, {});
}

/**
 * Filtra productos por texto de búsqueda.
 */
export function searchProducts(products: Product[], query: string | null | undefined): Product[] {
    if (!query || query.trim() === '') return products;
    const q = query.toLowerCase().trim();
    return products.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q))
    );
}

/**
 * Calcula el total del carrito.
 */
export function calcCartTotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + (item.qty * item.price), 0);
}

/**
 * Calcula el IVA de un monto.
 */
export function calcTax(amount: number, rate = 0.16): number {
    return amount * rate;
}

/**
 * Redondeo seguro.
 */
export function roundTo(value: number, decimals = 2): number {
    const mult = Math.pow(10, decimals);
    return Math.round(value * mult) / mult;
}

/**
 * Debounce para búsquedas.
 */
export function debounce<T extends (...args: never[]) => void>(fn: T, delay = 300): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: Parameters<T>) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(null, args), delay);
    };
}

/**
 * Detecta si un texto parece ser una notificación de pago móvil.
 */
export function isMobilePayment(text: string): boolean {
    const bankKeywords = /BS\.?|VES|PAGO|REF|REFERENCIA|MONTO/i;
    return bankKeywords.test(text);
}

/**
 * Parsea un mensaje de texto de pago móvil (Venezuela).
 * Extrae: banco, monto, referencia.
 */
export function parseMobilePayment(text: string | null | undefined): PaymentInfo | null {
    if (!text) return null;

    const cleanText = text.replace(/\s+/g, ' ').trim();
    const uppercaseText = cleanText.toUpperCase();

    let amount = 0;
    let reference = '---';
    let bank = 'Desconocido';

    // Extraer monto: formato venezolano (1.250,00)
    const amountRegex = /(?:BS\.?|MONTO(?:\s?DE)?|CANTIDAD(?:\s?DE)?|SUMA(?:\s?DE)?)\s?:?\s*([\d.]+,\d{2})/i;
    const amountMatch = cleanText.match(amountRegex);

    if (amountMatch) {
        amount = parseFloat(amountMatch[1].replace(/\./g, '').replace(',', '.'));
    } else {
        const fallbackRegex = /(?:^|\s)([\d.]+,\d{2})(?:\s|$)/;
        const fallbackMatch = cleanText.match(fallbackRegex);
        if (fallbackMatch) {
            amount = parseFloat(fallbackMatch[1].replace(/\./g, '').replace(',', '.'));
        }
    }

    // Extraer referencia (6-14 dígitos)
    const refRegex = /(?:REF\.?|REFERENCIA|CONFIRMACION|NRO|#)\s?:?\s*(\d{6,14})/i;
    const refMatch = cleanText.match(refRegex);

    if (refMatch) {
        reference = refMatch[1].trim();
    } else {
        const fallbackRefRegex = /(?:\s|^)(\d{6,14})(?:\s|$)/g;
        let m: RegExpExecArray | null;
        while ((m = fallbackRefRegex.exec(cleanText)) !== null) {
            const potentialRef = m[1];
            if (potentialRef !== amountMatch?.[1]?.replace(/\D/g, '')) {
                reference = potentialRef;
                break;
            }
        }
    }

    // Detectar banco
    const bankKeywords: Record<string, string> = {
        BANESCO: 'Banesco',
        VENEZUELA: 'BDV',
        BDV: 'BDV',
        MERCANTIL: 'Mercantil',
        PROVINCIAL: 'Provincial',
        BBVA: 'Provincial',
        BANCARIBE: 'Bancaribe',
        BNC: 'BNC',
        BANCAMIGA: 'Bancamiga',
        BANPLUS: 'Banplus',
        TESORO: 'B. Tesoro',
        BICENTENARIO: 'Bicentenario',
        PLAZA: 'B. Plaza',
        ACTIVO: 'B. Activo',
        EXTERIOR: 'B. Exterior',
        CARONI: 'B. Caroní',
        AGRICOLA: 'B. Agrícola',
        SOFITASA: 'Sofitasa',
        'VENEZOLANO DE CREDITO': 'VDC',
        RESERVA: 'B. Reserva',
        'DEL SUR': 'Del Sur',
    };

    for (const key in bankKeywords) {
        if (uppercaseText.includes(key)) {
            bank = bankKeywords[key];
            break;
        }
    }

    if (amount > 0 && reference !== '---') {
        return { bank, amount, reference, rawText: text };
    }
    return null;
}
