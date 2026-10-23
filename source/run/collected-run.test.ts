import { runIfMain } from '#test-runner';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { collectedRunCommand, collectLifecycleRun } from '../test-support/collected-run-fixtures.ts';
import { equals } from './run-selection-filters.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const all = { selection: { kind: 'all' } } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'collected runner execution',
    children: [
        createTestCase({
            ...metadata,
            title: 'reruns reuse the plan with fresh scopes, assertion counts, signals, and cleanup',
            async body(scope) {
                const { collected, state } = await collectLifecycleRun(collectedRunCommand());
                const first = await collected.run(all);
                const second = await collected.run(all);
                const scopes = new Set(state.scopes);
                scope.assert.deepEqual({
                    calls: state.calls,
                    cleanupCount: state.cleanupCount,
                    closedScopes: state.scopes.every(function scopeWasClosed(caseScope) {
                        return caseScope.signal.aborted;
                    }),
                    errors: [ first.runnerErrors, second.runnerErrors ],
                    independentResults: first.perTest !== second.perTest,
                    resultCounts: [ first.perTest.length, second.perTest.length ],
                    statuses: [ first.status, second.status ],
                    uniqueScopes: scopes.size
                }, {
                    calls: [ 'first', 'second', 'first', 'second' ],
                    cleanupCount: 4,
                    closedScopes: true,
                    errors: [ [], [] ],
                    independentResults: true,
                    resultCounts: [ 2, 2 ],
                    statuses: [ 'passed', 'passed' ],
                    uniqueScopes: 4
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'invocation selection cannot restore initially filtered cases',
            async body(scope) {
                const command = collectedRunCommand();
                const { collected, state } = await collectLifecycleRun({
                    ...command,
                    request: {
                        ...command.request,
                        selection: { kind: 'filter', filter: equals('title', 'first') }
                    }
                });
                const first = await collected.run(all);
                const empty = await collected.run({ selection: { kind: 'filter', filter: equals('title', 'second') } });
                const again = await collected.run(all);
                scope.assert.deepEqual({
                    calls: state.calls,
                    counts: [ first.summary.discovered, first.summary.planned ],
                    empty: [ empty.status, empty.planStatus, empty.summary.planned ],
                    repeatedTitles: again.perTest.map(function caseTitle(result) {
                        return result.id.title;
                    }),
                    seed: collected.facts.reproducibility.seed
                }, {
                    calls: [ 'first', 'first' ],
                    counts: [ 2, 1 ],
                    empty: [ 'failed', 'empty-selection', 0 ],
                    repeatedTitles: [ 'first' ],
                    seed: '42'
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'narrowing preserves the collected ordering and discovery counts',
            async body(scope) {
                const { collected, state } = await collectLifecycleRun(collectedRunCommand());
                const selected = await collected.run({
                    selection: { kind: 'filter', filter: equals('title', 'second') }
                });
                const complete = await collected.run(all);
                scope.assert.deepEqual({
                    calls: state.calls,
                    counts: [ selected.summary.discovered, selected.summary.planned, selected.summary.passed ],
                    fullTitles: complete.perTest.map(function caseTitle(result) {
                        return result.id.title;
                    }),
                    catalogTitles: collected.plan.files.flatMap(function fileTitles(file) {
                        return file.cases.map(function caseTitle(testCase) {
                            return testCase.title;
                        });
                    })
                }, {
                    calls: [ 'second', 'first', 'second' ],
                    counts: [ 2, 1, 1 ],
                    fullTitles: [ 'first', 'second' ],
                    catalogTitles: [ 'first', 'second' ]
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'overlapping invocations reject before running cases and release ownership',
            async body(scope) {
                const { collected, state } = await collectLifecycleRun(collectedRunCommand());
                const gate = Promise.withResolvers<undefined>();
                state.gate = gate.promise;
                const running = collected.run(all);
                await scope.assert.rejects(async function runOverlappingInvocation() {
                    await collected.run(all);
                }, { message: 'A collected plan invocation is already running.' });
                gate.resolve(undefined);
                const results = [ await running, await collected.run(all) ];
                scope.assert.deepEqual({
                    cleanupCount: state.cleanupCount,
                    statuses: results.map(function runStatus(result) {
                        return result.status;
                    })
                }, { cleanupCount: 4, statuses: [ 'passed', 'passed' ] });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'zero assertions and failures do not contaminate subsequent invocations',
            async body(scope) {
                const { collected, state } = await collectLifecycleRun(collectedRunCommand());
                state.mode = 'no-assertions';
                const noAssertions = await collected.run(all);
                state.mode = 'fail';
                const failed = await collected.run(all);
                state.mode = 'pass';
                const passed = await collected.run(all);
                scope.assert.deepEqual({
                    cleanupCount: state.cleanupCount,
                    failedCounts: [ noAssertions.summary.failed, failed.summary.failed, passed.summary.failed ],
                    statuses: [ noAssertions.status, failed.status, passed.status ]
                }, { cleanupCount: 6, failedCounts: [ 2, 2, 0 ], statuses: [ 'failed', 'failed', 'passed' ] });
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
