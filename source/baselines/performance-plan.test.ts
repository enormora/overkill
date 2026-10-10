import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { proposePerformanceBaseline } from './performance-plan.ts';
import type { PerformanceBaselineAdapter, PerformanceBaselineValue } from './performance-adapter.ts';

const actual: PerformanceBaselineValue = {
    calibration: { context: {}, kind: 'comparable', machineClass: 'test-host', metadata: {} },
    value: { duration: 100 }
};
const adapter: PerformanceBaselineAdapter = {
    id: 'duration',
    observe() {
        return { kind: 'observed', value: actual.value };
    },
    compare() {
        return { kind: 'match' };
    },
    propose(input) {
        return input.actual.value;
    }
};
const input = {
    actual,
    adapter,
    existing: null,
    maxBytes: 4096,
    mode: 'update',
    profile: 'startup',
    work: createDefaultWorkId(createCaseId('startup.bench.ts', [], 'starts', null))
} as const;

export const testNode = suite('performance baseline change planning', [
    test('creates missing expectations only for explicit update modes', function (scope: TestScope) {
        scope.assert.equal(proposePerformanceBaseline({ ...input, mode: 'none' }), null);
        for (const mode of [ 'update', 'apply', 'bootstrap', 'diff' ] as const) {
            scope.assert.equal(proposePerformanceBaseline({ ...input, mode })?.kind, 'create');
        }
        return scope.assert.collect();
    }),
    test(
        'proposes changes independently of tolerant comparison and preserves existing bootstrap values',
        function (scope: TestScope) {
            const creation = proposePerformanceBaseline(input);
            scope.require.defined(creation);
            const changed = { ...input, existing: creation.baseline, actual: { ...actual, value: { duration: 110 } } };
            scope.assert.equal(
                adapter.compare({ actual: changed.actual, expected: creation.baseline.expected }).kind,
                'match'
            );
            scope.assert.equal(proposePerformanceBaseline(changed)?.kind, 'update');
            scope.assert.equal(proposePerformanceBaseline({ ...changed, mode: 'bootstrap' }), null);
            scope.assert.equal(proposePerformanceBaseline({ ...input, existing: creation.baseline }), null);
            return scope.assert.collect();
        }
    ),
    test('rejects invalid or oversized proposals', function (scope: TestScope) {
        scope.assert.throws(function rejectOversizedProposal() {
            proposePerformanceBaseline({ ...input, maxBytes: 1 });
        }, { message: 'Performance baseline proposal exceeds the configured artifact byte limit.' });
        return scope.assert.collect();
    })
]);
