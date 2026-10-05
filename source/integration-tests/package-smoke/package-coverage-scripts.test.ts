import { fromObject } from 'convert-source-map';
import { transform } from 'sucrase';

export type CoverageSourceKind = 'javascript' | 'mapped' | 'unloaded';

export function coverageSourceFile(sourceKind: CoverageSourceKind): string {
    const files = { javascript: 'coverage-source.mjs', mapped: 'coverage-source.ts', unloaded: 'coverage-unloaded.ts' };

    return files[sourceKind];
}

export function createCoverageConfigScript(
    processModel: 'in-process' | 'supervised-process',
    sourceKind: CoverageSourceKind
): string {
    return [
        "import { defineConfig } from '@overkill-dev/test/config';",
        '',
        'export const config = defineConfig({',
        '    profiles: {',
        '        microtest: {',
        "            testFamily: 'microtest',",
        `            coverage: { outputDir: 'coverage-smoke', sources: { mode: 'all', include: ${
            JSON.stringify([ coverageSourceFile(sourceKind), 'coverage-types.ts' ])
        } } },`,
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

export const coverageTypeScriptSource = [
    'export function double(value: number): number {',
    '    return value * 2;',
    '}',
    ''
]
    .join('\n');

export function coverageGeneratedScript(sourceKind: CoverageSourceKind): string {
    if (sourceKind !== 'mapped') {
        return coverageSourceScript;
    }
    const compiled = transform(coverageTypeScriptSource, {
        filePath: 'coverage-source.ts',
        sourceMapOptions: { compiledFilename: 'coverage-source.mjs' },
        transforms: [ 'typescript' ]
    });
    const map = { ...compiled.sourceMap, sourcesContent: [ coverageTypeScriptSource ] };

    return `${compiled.code}\n${fromObject(map).toComment()}\n`;
}

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
