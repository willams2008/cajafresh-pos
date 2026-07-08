const js = require('@eslint/js');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
    js.configs.recommended,
    {
        rules: {
            'no-unused-vars': ['warn', { 
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^(format|formatVES|formatUSD|formatEUR)'
            }],
            'no-undef': 'off',
            'no-empty': 'warn',
            'no-constant-condition': 'warn',
            'no-prototype-builtins': 'off',
            'prefer-const': 'warn',
        },
        ignores: [
            'dist*/',
            'temp*/',
            'node_modules/',
            '*.config.js',
            '*.config.mjs',
        ],
    },
];
