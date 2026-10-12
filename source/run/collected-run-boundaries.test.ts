import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { orchestrator } from '../packages/run/run.entry-point.ts';
import { collectedRunCommand, collectLifecycleRun } from '../test-support/collected-run-fixtures.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import { equals } from './run-selection-filters.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const all = { selection: { kind: 'all' } } as const;

export const testNode = createSuite({
    ...metadata,
    title: 'collected runner boundaries',
    children: [
        createTestCase({
            ...metadata,
            title: 'collection timeout is cached and releases observers',
            async body(scope) {
                const command = collectedRunCommand();
                const ready = await orchestrator.initialize({
                    ...command,
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: { processModel: 'in-process', scheduling: 'serial' },
                                timeouts: { collectionMilliseconds: 20 }
                            })
                        }
                    }),
                    request: {
                        ...command.request,
                        paths: [ 'source/integration-tests/run/fixtures/collected-timeout.test.ts' ]
                    }
                });
                const listeners = process.listenerCount('newListener');
                await scope.assert.rejects(async function collectTimedOutModule() {
                    await ready.collect();
                }, { message: 'Collection exceeded collection timeout.' });
                await scope.assert.rejects(async function repeatTimedOutCollection() {
                    await ready.collect();
                }, { message: 'Collection exceeded collection timeout.' });
                scope.assert.true(process.listenerCount('newListener') === listeners);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'initially unmatched selections reject collection and retain the failure',
            async body(scope) {
                const command = collectedRunCommand();
                const ready = await orchestrator.initialize({
                    ...command,
                    request: {
                        ...command.request,
                        selection: { kind: 'filter', filter: equals('title', 'missing') }
                    }
                });
                await scope.assert.rejects(async function collectUnmatchedSelection() {
                    await ready.collect();
                }, { message: 'Run selection matched no test cases.' });
                await scope.assert.rejects(async function repeatUnmatchedCollection() {
                    await ready.collect();
                }, { message: 'Run selection matched no test cases.' });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'collection keeps configured family validation',
            async body(scope) {
                const command = collectedRunCommand();
                const ready = await orchestrator.initialize({
                    ...command,
                    request: {
                        ...command.request,
                        paths: [ 'source/integration-tests/run/fixtures/wrong-family.test.ts' ]
                    }
                });
                await scope.assert.rejects(async function collectWrongFamily() {
                    await ready.collect();
                }, { message: /integration/u });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'empty shards stay passing on repeated invocation',
            async body(scope) {
                const command = collectedRunCommand();
                const handles = await Promise.all([ 1, 2, 3 ].map(async function collectShard(index) {
                    const ready = await orchestrator.initialize({
                        ...command,
                        request: {
                            ...command.request,
                            shard: { index, total: 3 }
                        }
                    });
                    return await ready.collect();
                }));
                const empty = handles.find(function isEmpty(handle) {
                    return handle.facts.cases.length === 0;
                });
                if (empty === undefined) {
                    throw new Error('Expected an empty shard.');
                }
                const results = [ await empty.run(all), await empty.run(all) ];
                scope.assert.deepEqual(
                    results.map(function shardResult(result) {
                        return [ result.status, result.planStatus, result.summary.planned, result.runnerErrors.length ];
                    }),
                    [ [ 'passed', 'empty-shard', 0, 0 ], [ 'passed', 'empty-shard', 0, 0 ] ]
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'soft timeouts close scopes and leave the next invocation runnable',
            async body(scope) {
                const command = collectedRunCommand();
                const { collected, state } = await collectLifecycleRun({
                    ...command,
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: { processModel: 'in-process', scheduling: 'serial' },
                                timeouts: { softMilliseconds: 20, hardMilliseconds: 200 }
                            })
                        }
                    })
                });
                state.mode = 'timeout';
                const timedOut = await collected.run({
                    selection: { kind: 'filter', filter: equals('title', 'first') }
                });
                state.mode = 'pass';
                const passed = await collected.run(all);
                scope.assert.deepEqual({
                    cleanupCount: state.cleanupCount,
                    scopesClosed: state.scopes.every(function closed(caseScope) {
                        return caseScope.signal.aborted;
                    }),
                    statuses: [ timedOut.status, passed.status ],
                    failures: timedOut.perTest.flatMap(function timeoutFailures(result) {
                        return result.outcome?.kind === 'fail'
                            ? result.outcome.failures.map(function failureKind(failure) {
                                return failure.kind;
                            })
                            : [];
                    })
                }, { cleanupCount: 3, scopesClosed: true, statuses: [ 'failed', 'passed' ], failures: [ 'timeout' ] });
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
