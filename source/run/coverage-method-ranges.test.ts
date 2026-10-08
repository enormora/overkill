import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { normalizeCoverageMethodRanges } from './coverage-method-ranges.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'source/run/coverage-method-ranges.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'rejects function coverage without its root range',
            body(scope) {
                scope.assert.throws(function readIncompleteCoverage() {
                    normalizeCoverageMethodRanges([
                        { functionName: 'replace', isBlockCoverage: true, ranges: [] }
                    ], 'const box = { replace(value) { return value; } };');
                }, { name: 'ZodError' });
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
