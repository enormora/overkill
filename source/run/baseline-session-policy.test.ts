import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { ordinaryBaselineSessionFixture } from '../test-support/ordinary-baseline-session.ts';
import { baselineCaseEvent, baselineCaseResult, storedBaseline } from '../test-support/baseline-case-fixture.ts';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import { createOrdinaryBaselineSession } from './baseline-session.ts';
import { baselineRunnerError } from './baseline-outcomes.ts';
import { readOrdinaryBaselineReport } from './baseline-report.ts';

const maxBytes = 65_536;
export const testNode: TestNode = suite('ordinary baseline session policy', [
    table({
        title: 'validates proposals and returns a read-only report',
        cases: [ 'none', 'diff' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const fixture = ordinaryBaselineSessionFixture();
            const session = createOrdinaryBaselineSession({
                mode,
                maxBytes,
                workflow: fixture.workflow,
                dispatcher: fixture.dispatcher
            });
            const result = await session.finalize(baselineCaseResult);
            scope.assert.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'read-only');
            scope.assert.deepEqual(fixture.calls, [ 'validate:1' ]);
            scope.assert.deepEqual(await fixture.store.list(), []);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'publishes successful proposals and retains their report',
        cases: [ 'update', 'apply' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const fixture = ordinaryBaselineSessionFixture();
            const session = createOrdinaryBaselineSession({
                mode,
                maxBytes,
                workflow: fixture.workflow,
                dispatcher: fixture.dispatcher
            });
            const result = await session.finalize(baselineCaseResult);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'written');
            scope.assert.deepEqual(fixture.calls, [ 'publish:1' ]);
            const records = await fixture.store.list();
            scope.assert.deepEqual(
                records.map(function (record) {
                    return record.baseline;
                }),
                [ storedBaseline ]
            );
            return scope.assert.collect();
        }
    }),
    test('blocks publication after an unsuccessful execution', async function (scope) {
        const fixture = ordinaryBaselineSessionFixture();
        const session = createOrdinaryBaselineSession({
            mode: 'update',
            maxBytes,
            workflow: fixture.workflow,
            dispatcher: fixture.dispatcher
        });
        const failed = {
            ...baselineCaseResult,
            status: 'failed',
            summary: { ...baselineCaseResult.summary, failed: 1 }
        } as const;
        const result = await session.finalize(failed);
        scope.assert.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(fixture.calls, []);
        scope.assert.deepEqual(await fixture.store.list(), []);
        return scope.assert.collect();
    }),
    test('rejects an oversized report before publishing proposals', async function (scope) {
        const fixture = ordinaryBaselineSessionFixture();
        const session = createOrdinaryBaselineSession({
            mode: 'update',
            maxBytes: 1,
            workflow: fixture.workflow,
            dispatcher: fixture.dispatcher
        });
        const result = await session.finalize(baselineCaseResult);
        scope.assert.equal(result.status, 'failed');
        scope.assert.true(result.runnerErrors.length > 0);
        scope.assert.true(result.runnerErrors.every(function (error) {
            return error.subtype === 'artifact';
        }));
        scope.assert.equal(readOrdinaryBaselineReport(result), null);
        scope.assert.deepEqual(fixture.calls, []);
        return scope.assert.collect();
    }),
    test(
        'notifies reporters about evaluation errors before delivering the evaluated event',
        async function (scope) {
            const fixture = ordinaryBaselineSessionFixture();
            const error = baselineRunnerError(new Error('Evaluation failed.'), baselineCaseEvent);
            const workflow = {
                ...fixture.workflow,
                async evaluate() {
                    return { event: { ...baselineCaseEvent, durationMicroseconds: 42 }, errors: [ error ] };
                }
            };
            const session = createOrdinaryBaselineSession({
                mode: 'update',
                maxBytes,
                workflow,
                dispatcher: fixture.dispatcher
            });
            const delivery = await session.reporterDispatcher.createDelivery(
                [ fixture.reporter ],
                createPlainOutputRenderer()
            );
            const errors = await delivery.reportEvent(baselineCaseEvent);
            await delivery.disposeReporters();
            const delivered = fixture.events[1];
            scope.assert.deepEqual({
                errors,
                events: fixture.events.map(function (event) {
                    return event.kind;
                }),
                duration: delivered?.kind === 'test-end' ? delivered.durationMicroseconds : null
            }, { errors: [ error ], events: [ 'runner-error', 'test-end' ], duration: 42 });
            return scope.assert.collect();
        }
    ),
    test(
        'reports inventory errors collected during result preparation exactly once',
        async function (scope) {
            const fixture = ordinaryBaselineSessionFixture();
            const error = baselineRunnerError(new Error('Inventory changed.'), null);
            const workflow = {
                ...fixture.workflow,
                prepareResult(result: typeof baselineCaseResult) {
                    return result.runnerErrors.includes(error)
                        ? result
                        : appendRunnerErrors(result, [ error ]);
                }
            };
            const session = createOrdinaryBaselineSession({
                mode: 'update',
                maxBytes,
                workflow,
                dispatcher: fixture.dispatcher
            });
            const prepared = session.prepareResult(baselineCaseResult);
            const delivery = await session.reporterDispatcher.createDelivery(
                [ fixture.reporter ],
                createPlainOutputRenderer()
            );
            const result = await session.finalize(prepared);
            await delivery.disposeReporters();
            scope.assert.deepEqual({
                status: result.status,
                events: fixture.events.map(function (event) {
                    return event.kind;
                })
            }, { status: 'failed', events: [ 'runner-error' ] });
            return scope.assert.collect();
        }
    )
]);
