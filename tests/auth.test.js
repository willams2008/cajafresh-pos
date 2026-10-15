/**
 * Tests unitarios para Autenticación, Roles y Permisos de Cajero/Admin
 */

describe('Auth & Role Permissions', () => {
    const ADMIN_PIN = '32447974';

    function verifyAdminPIN(inputPin) {
        if (!inputPin || typeof inputPin !== 'string') return false;
        return inputPin.trim() === ADMIN_PIN;
    }

    const ROLE_PERMISSIONS = {
        admin: ['pos', 'reports', 'settings', 'inventory', 'cashup', 'void_sale', 'modify_price'],
        cajero: ['pos', 'cashup'],
    };

    function hasPermission(role, action) {
        const perms = ROLE_PERMISSIONS[role] || [];
        return perms.includes(action);
    }

    test('valida PIN de administrador correctamente', () => {
        expect(verifyAdminPIN('32447974')).toBe(true);
        expect(verifyAdminPIN(' 32447974 ')).toBe(true);
        expect(verifyAdminPIN('1234')).toBe(false);
        expect(verifyAdminPIN('')).toBe(false);
        expect(verifyAdminPIN(null)).toBe(false);
    });

    test('restringe acciones críticas para rol cajero', () => {
        expect(hasPermission('cajero', 'pos')).toBe(true);
        expect(hasPermission('cajero', 'cashup')).toBe(true);
        expect(hasPermission('cajero', 'void_sale')).toBe(false);
        expect(hasPermission('cajero', 'modify_price')).toBe(false);
        expect(hasPermission('cajero', 'settings')).toBe(false);
    });

    test('permite todas las acciones para rol admin', () => {
        expect(hasPermission('admin', 'pos')).toBe(true);
        expect(hasPermission('admin', 'void_sale')).toBe(true);
        expect(hasPermission('admin', 'modify_price')).toBe(true);
        expect(hasPermission('admin', 'settings')).toBe(true);
    });
});
