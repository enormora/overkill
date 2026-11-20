import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { baselineCaseResult } from '../test-support/baseline-case-fixture.ts';
import { performanceFinalization } from '../test-support/performance-finalization.ts';
import { readPerformanceBaselineReport } from '../baselines/performance-report.ts';
import type { BaselineUpdateMode } from '../baselines/performance-baseline.ts';

import { finalizeBenchmarkBaselines } from './benchmark-baseline-finalization.ts';

const modes: readonly BaselineUpdateMode[] = [ 'none', 'diff', 'update', 'apply', 'bootstrap' ];
export const testNode: TestNode = suite('benchmark baseline publication', [
    table({
        title: 'finalizes baseline proposals with inspectable reports',
        cases: modes,
        caseTitle(mode) {
            return `${mode}`;
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const mode = scope.parameters;

            const fixture = await performanceFinalization(mode, null);
            const result = await finalizeBenchmarkBaselines({
                ...fixture,
                mode,
                result: baselineCaseResult,
                completeInventory: true,
                maxBytes: 4096
            });
            const report = readPerformanceBaselineReport(result);
            require.defined(report);
            scope.assert.equal(
                report.writeOutcome.kind,
                mode === 'none' || mode === 'diff' ? 'read-only' : 'written'
            );
            scope.assert.deepEqual(
                fixture.applied,
                mode === 'none' || mode === 'diff' ? [] : fixture.workflow.changes
            );
            scope.assert.deepEqual(fixture.notified, []);
            return scope.assert.collect();
        }
    }),
    test('blocks proposals when the execution failed', async function (scope) {
        const fixture = await performanceFinalization('update', null);
        const result = await finalizeBenchmarkBaselines({
            ...fixture,
            mode: 'update',
            result: {
                ...baselineCaseResult,
                status: 'failed',
                runnerErrors: [ {
                    attributedTo: null,
                    attributedToAttempt: null,
                    cause: new Error('Execution crashed.'),
                    diagnostics: [],
                    message: 'Execution crashed.',
                    subtype: 'crash'
                } ]
            },
            completeInventory: true,
            maxBytes: 4096
        });
        scope.assert.equal(readPerformanceBaselineReport(result)?.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(fixture.applied, []);
        return scope.assert.collect();
    }),
    test('retains publication errors in the result and report', async function (scope) {
        const fixture = await performanceFinalization('update', new Error('Publication failed.'));
        const result = await finalizeBenchmarkBaselines({
            ...fixture,
            mode: 'update',
            result: baselineCaseResult,
            completeInventory: true,
            maxBytes: 4096
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(readPerformanceBaselineReport(result)?.writeOutcome.kind, 'failed');
        scope.assert.includes(JSON.stringify(result.runnerErrors), 'Publication failed.');
        scope.assert.equal(fixture.notified.length, 1);
        scope.assert.deepEqual(fixture.applied, []);
        return scope.assert.collect();
    }),
    test('rejects an oversized report before writing any proposal', async function (scope) {
        const fixture = await performanceFinalization('update', null);
        const result = await finalizeBenchmarkBaselines({
            ...fixture,
            mode: 'update',
            result: baselineCaseResult,
            completeInventory: true,
            maxBytes: 1
        });
        scope.assert.equal(result.status, 'failed');
        scope.assert.deepEqual(fixture.applied, []);
        scope.assert.equal(readPerformanceBaselineReport(result), null);
        scope.assert.true(fixture.notified.length > 0);
        return scope.assert.collect();
    })
]);
