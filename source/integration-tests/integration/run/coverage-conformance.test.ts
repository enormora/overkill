import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestNode, suite } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { collectCoverageScript, withCoverageSources } from '../../../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from '../../../run/coverage-reporting.ts';

const countersSchema = z.record(
    z.string(),
    z.object({
        b: z.record(z.string(), z.array(z.number())),
        f: z.record(z.string(), z.number()),
        s: z.record(z.string(), z.number())
    })
);
const body = [
    '    const nested = (item) => item?.value ?? 0;',
    '    let result = value ? nested({ value: 2 }) : nested(null);',
    '    for (let index = 0; index < value; index += 1) {',
    '        if (index === 1) continue;',
    '        result += index;',
    '    }',
    '    switch (value) {',
    '        case 0: result += 3; break;',
    '        case 2: result += 4; break;',
    '        default: result += 5;',
    '    }',
    '    try {',
    '        if (value < 0) throw new Error("negative");',
    '    } catch {',
    '        result = -1;',
    '    } finally {',
    '        result += 1;',
    '    }',
    '    return result;',
    '}',
    '}',
    'const box = new Box();',
    'box.pick();',
    'box.pick(2);',
    ''
]
    .join('\n');

async function coverageSnapshot(header: string, extension: string): Promise<{
    readonly summary: unknown;
    readonly counters: unknown;
}> {
    let snapshot: { readonly summary: unknown; readonly counters: unknown; } = { summary: null, counters: null };
    const file = `value.${extension}`;

    await withCoverageSources([ {
        file,
        loaded: false,
        source: `class Box {\n${header}\n${body}`
    } ], async function captureCoverage(fixture) {
        await collectCoverageScript(fixture, file);
        const report = await generateCoverageReports({
            ...fixture,
            outputs: [ 'json' ],
            sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
        });
        const counters = countersSchema.parse(JSON.parse(
            await readFile(path.join(fixture.coverageDirectory, 'coverage-final.json'), 'utf8')
        ));

        snapshot = { summary: report.summary, counters: Object.values(counters) };
    });
    return snapshot;
}

export const testNode: TestNode = suite(
    'Coverage conformance',
    [ table({
        title: 'native preserves JavaScript coverage for nested branches and control flow',
        cases: [ 'ts', 'mts', 'cts' ],
        caseTitle: String,
        async test(scope) {
            const extension = scope.parameters;

            const javascript = await coverageSnapshot('pick(value = 0) {', 'mjs');
            const typescript = await coverageSnapshot(
                'pick<T extends number>(value: T | number = 0): number {',
                extension
            );

            scope.assert.deepEqual(typescript, javascript);
            return scope.assert.collect();
        }
    }) ]
);
