export function createCoverageConfigScript(processModel: 'in-process' | 'supervised-process'): string {
    return [
        "import { defineConfig } from '@overkill-dev/test/config';",
        '',
        'export const config = defineConfig({',
        '    profiles: {',
        '        microtest: {',
        "            testFamily: 'microtest',",
        "            coverage: { outputDir: 'coverage-smoke' },",
        '            execution: {',
        `                processModel: '${processModel}',`,
        "                scheduling: 'serial'",
        '            }',
        '        }',
        '    }',
        '});',
        ''
    ]
        .join('\n');
}

export const coverageSourceScript = [
    'export function double(value) {',
    '    return value * 2;',
    '}',
    ''
]
    .join('\n');

export const coverageSmokeScript = [
    "import { test } from '@overkill-dev/test';",
    "import { double } from './coverage-source.mjs';",
    '',
    "export const testNode = test('covers consumer source', (scope) => {",
    '    scope.assert.equal(double(21), 42);',
    '    return scope.assert.collect();',
    '});',
    ''
]
    .join('\n');
