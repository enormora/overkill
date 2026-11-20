import { type TestNode, table, suite, test } from '@overkill-dev/test';

import {
    benchmarkBaselineSessionFixture,
    benchmarkSessionScenario
} from '../test-support/benchmark-baseline-session.ts';
import { baselineCaseResult, baselineCaseEvent } from '../test-support/baseline-case-fixture.ts';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { performanceBaselineError } from '../baselines/performance-evaluation.ts';
import { readPerformanceBaselineReport } from '../baselines/performance-report.ts';
import { openBenchmarkBaselineSession } from './benchmark-baseline-session.ts';

export const testNode: TestNode = suite('benchmark baseline session ownership', [
    test('preserves prepared results and attaches the baseline report', async function (scope) {
        const fixture = benchmarkBaselineSessionFixture(benchmarkSessionScenario);
        const session = await openBenchmarkBaselineSession(fixture.input, fixture.store);
        scope.assert.equal(session.prepareResult(baselineCaseResult), baselineCaseResult);
        const result = await session.finalize(baselineCaseResult);
        scope.assert.equal(result.status, 'passed');
        scope.assert.equal(readPerformanceBaselineReport(result)?.writeOutcome.kind, 'read-only');
        return scope.assert.collect();
    }),
    test(
        'forwards case events and reporter disposal through the baseline delivery',
        async function (scope) {
            const fixture = benchmarkBaselineSessionFixture(benchmarkSessionScenario);
            const session = await openBenchmarkBaselineSession(fixture.input, fixture.store);
            const delivery = await session.reporterDispatcher.createDelivery(
                [ fixture.reporter ],
                createPlainOutputRenderer()
            );
            scope.assert.deepEqual(await delivery.reportEvent(baselineCaseEvent), []);
            scope.assert.deepEqual(await delivery.reportResult(baselineCaseResult), []);
            scope.assert.deepEqual(await delivery.disposeReporters(), []);
            scope.assert.deepEqual(fixture.events, [ baselineCaseEvent ]);
            return scope.assert.collect();
        }
    ),
    test(
        'forwards runner errors without evaluating them as benchmark outcomes',
        async function (scope) {
            const fixture = benchmarkBaselineSessionFixture(benchmarkSessionScenario);
            const session = await openBenchmarkBaselineSession(fixture.input, fixture.store);
            const delivery = await session.reporterDispatcher.createDelivery(
                [ fixture.reporter ],
                createPlainOutputRenderer()
            );
            const event = {
                kind: 'runner-error',
                error: performanceBaselineError(new Error('External failure.'), null)
            } as const;
            scope.assert.deepEqual(await delivery.reportEvent(event), []);
            await delivery.disposeReporters();
            scope.assert.deepEqual(fixture.events, [ event ]);
            return scope.assert.collect();
        }
    ),
    test(
        'retains report publication errors before reporter delivery starts',
        async function (scope) {
            const fixture = benchmarkBaselineSessionFixture({ ...benchmarkSessionScenario, maxBytes: 1 });
            const session = await openBenchmarkBaselineSession(fixture.input, fixture.store);
            const result = await session.finalize(baselineCaseResult);
            scope.assert.true(result.runnerErrors.length > 0);
            scope.assert.deepEqual(fixture.events, []);
            return scope.assert.collect();
        }
    ),
    test(
        'notifies the active reporter when baseline report publication fails',
        async function (scope) {
            const fixture = benchmarkBaselineSessionFixture({ ...benchmarkSessionScenario, maxBytes: 1 });
            const session = await openBenchmarkBaselineSession(fixture.input, fixture.store);
            const delivery = await session.reporterDispatcher.createDelivery(
                [ fixture.reporter ],
                createPlainOutputRenderer()
            );
            const result = await session.finalize(baselineCaseResult);
            scope.assert.true(result.runnerErrors.length > 0);
            scope.assert.true(fixture.events.some(function (event) {
                return event.kind === 'runner-error';
            }));
            await delivery.disposeReporters();
            return scope.assert.collect();
        }
    ),
    table({
        title: 'requires complete inventory admission before pruning stale baselines',
        cases: [ 'complete', 'paths', 'selection', 'shard' ] as const,
        caseTitle(selection) {
            return `${selection}`;
        },
        async test(scope) {
            const selection = scope.parameters;

            const fixture = benchmarkBaselineSessionFixture({
                ...benchmarkSessionScenario,
                mode: 'apply',
                existing: true
            });
            const request = {
                ...fixture.input.request,
                paths: selection === 'paths' ? [ 'subject.bench.ts' ] : [],
                selection: selection === 'selection' ? { kind: 'none' as const } : { kind: 'all' as const },
                shard: selection === 'shard' ? { index: 1, total: 2 } : { index: 1, total: 1 }
            };
            const session = await openBenchmarkBaselineSession({ ...fixture.input, request }, fixture.store);
            const result = await session.finalize(baselineCaseResult);
            const stored = await fixture.store.list();
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(stored.length, selection === 'complete' ? 0 : 1);
            return scope.assert.collect();
        }
    })
]);
