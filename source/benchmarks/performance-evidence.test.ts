import { suite, test } from '@overkill-dev/test';
import { captureReference, readReference, verifyPerformance } from './performance-evidence.ts';

const count = 20;
const caseIds = [ 'startup' ];
const metric = 'durationMicroseconds';

function observation(decision: string, precise: boolean, upper: number, maximum: number): unknown {
    return {
        status: 'passed',
        errors: [],
        entries: [ {
            verdict: 'pass',
            benchmark: {
                workload: { name: 'startup' },
                status: 'complete',
                samples: count,
                metrics: { [metric]: { count, maximum: 50_000 } },
                budgets: [ { metric, decision, precise, interval: { lower: 40, upper }, maximum } ]
            }
        } ]
    };
}

export const testNode = suite('performance reference evidence', [
    test('rounds the calibrated ceiling in the same units as the budget', function (scope) {
        const reference = captureReference(observation('pass', true, 74_321, 80_000), caseIds, count);
        scope.assert.deepEqual(reference.thresholds, { startup: { [metric]: 75_000 } });
        return scope.assert.collect();
    }),
    test('shares timing and memory thresholds across platforms and Node versions', function (scope) {
        const reference = captureReference(observation('pass', true, 50, 80), caseIds, count);
        const foreignReference = {
            ...reference,
            host: { platform: 'foreign', architecture: 'foreign', node: 'v0.0.0' },
            thresholds: { startup: { durationMicroseconds: 50, peakResidentBytes: 80 } }
        };
        scope.assert.deepEqual(readReference(foreignReference), foreignReference.thresholds);
        return scope.assert.collect();
    }),
    test('blocks an interval that overlaps the ceiling', function (scope) {
        scope.assert.throws(function compare() {
            verifyPerformance(observation('undecided', true, 55, 50), caseIds, count);
        }, { type: Error, message: /Budget unproven/ });
        return scope.assert.collect();
    }),
    test('blocks a candidate with missing workloads', function (scope) {
        scope.assert.throws(function compare() {
            verifyPerformance(observation('pass', true, 45, 50), [ ...caseIds, 'import' ], count);
        }, { type: Error, message: /missing.*import/ });
        return scope.assert.collect();
    })
]);
