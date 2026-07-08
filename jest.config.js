/**
 * Jest Configuration — Caja Fresh POS
 *
 * Transforma módulos ES (import/export) con esbuild
 * para poder testear tanto src/renderer/*.js como app.js.
 */

module.exports = {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.(js|ts)$': ['jest-esbuild', {
            target: 'es2020',
            format: 'cjs',
            platform: 'browser',
        }],
    },
    moduleFileExtensions: ['js', 'ts', 'mjs'],
    testMatch: [
        '**/tests/**/*.test.js',
        '**/tests/**/*.spec.js',
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/dist_/',
        '/build/',
    ],
    transformIgnorePatterns: [
        '/node_modules/(?!(@?))',
    ],
    // Sobrescribe el entorno para módulos que dependen de DOM
    setupFiles: [],
    verbose: true,
    collectCoverage: process.env.CI ? true : false,
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/index.js',
    ],
    coverageReporters: ['text', 'lcov'],
};
