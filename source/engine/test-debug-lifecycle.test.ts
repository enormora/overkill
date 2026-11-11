import { runIfMain } from '#test-runner';
import { createDeterministicClock } from '@enormora/clock';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    isTestDebugArtifact,
    type ExecuteOptions,
    type RunResult,
    type TestDebugArtifact
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine, createTimedTestEngine } from '../test-support/create-test-engine.ts';
import { defaultAttachmentLimits } from './runtime-attachment.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const options: ExecuteOptions = {
    debug: { mode: 'all' },
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '1970-01-01T00:00:00.000Z'
};
function artifactFrom(result: RunResult): TestDebugArtifact {
    const artifact = result.artifacts.find(isTestDebugArtifact);
    if (artifact === undefined) {
        throw new Error('Expected a debug artifact.');
    }
    return artifact;
}
async function concurrentImportEvidence(specifier: string): Promise<RunResult> {
    const engine = createTestEngine();
    const secondStarted = Promise.withResolvers<undefined>();
    const firstImported = Promise.withResolvers<undefined>();
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [
            engine.createTestCase({
                ...metadata,
                title: 'importer',
                async body(inner) {
                    await secondStarted.promise;
                    try {
                        await import(specifier);
                        inner.assert.equal(1, 1);
                    } finally {
                        firstImported.resolve(undefined);
                    }
                    return inner.assert.collect();
                }
            }),
            engine.createTestCase({
                ...metadata,
                title: 'observer',
                async body(inner) {
                    secondStarted.resolve(undefined);
                    await firstImported.promise;
                    inner.assert.equal(1, 1);
                    return inner.assert.collect();
                }
            })
        ]
    }));
    return await engine.execute(plan, {
        ...options,
        execution: { mode: 'concurrent-in-process', maxConcurrency: 2 }
    });
}
export const testNode = suite('debug lifecycle', [
    test('concurrent debug scopes attribute module loads to the importing case', async function (scope: TestScope) {
        const specifier = `data:text/javascript,export default ${JSON.stringify('debug-module')}`;
        const result = await concurrentImportEvidence(specifier);
        const artifacts = result.artifacts.filter(isTestDebugArtifact);
        const [ importer, observer ] = [ 'importer', 'observer' ].map(function evidence(title) {
            return artifacts.find(function (artifact) {
                return artifact.id.scope.case.title === title;
            });
        });
        scope.require.defined(importer);
        scope.require.defined(observer);
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(
            importer
                .payload
                .moduleLoads
                .filter(function imported(module) {
                    return module.specifier === specifier;
                })
                .map(function phase(module) {
                    return module.phase;
                }),
            [ 'resolve', 'load' ]
        );
        scope.assert.deepEqual(observer.payload.moduleLoads, []);
        return scope.assert.collect();
    }),
    test(
        'recording registration stops at the limit without reading discarded providers',
        async function (scope: TestScope) {
            const engine = createTestEngine();
            const maximum = defaultAttachmentLimits.maxScopeAttachments;
            const plan = engine.createTestPlan(engine.createRoot({
                annotations: {},
                controls: {},
                title: 'root',
                children: [ engine.createTestCase({
                    ...metadata,
                    title: 'recordings',
                    body(inner) {
                        for (let index = 0; index < maximum; index += 1) {
                            inner.debug.includeRecording({
                                name: String(index),
                                recorded() {
                                    return [ index ];
                                }
                            });
                        }
                        inner.debug.includeRecording({
                            name: 'discarded',
                            recorded() {
                                throw new Error('Discarded providers must not run.');
                            }
                        });
                        inner.assert.equal(1, 1);
                        return inner.assert.collect();
                    }
                }) ]
            }));
            const result = await engine.execute(plan, options);
            const artifact = artifactFrom(result);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(artifact.payload.completeness, 'truncated');
            scope.assert.equal(artifact.payload.droppedEntries, 1);
            scope.assert.equal(artifact.payload.recordings.length, maximum);
            return scope.assert.collect();
        }
    ),
    test('skipped cases retain identity without invented body measurements', async function (scope: TestScope) {
        const engine = createTestEngine();
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [
                engine.createSkippedTestCase({ ...metadata, title: 'skip', reason: 'unavailable platform' })
            ]
        }));
        const result = await engine.execute(plan, options);
        const artifact = artifactFrom(result);
        scope.assert.equal(artifact.payload.verdict, 'skip');
        scope.assert.equal(artifact.payload.timeline.length, 0);
        scope.assert.equal(artifact.payload.cpuTimeMs.availability, 'unavailable');
        scope.assert.equal(artifact.payload.stats.heapGrowthBytes, null);
        return scope.assert.collect();
    }),
    test('soft-timeout headroom uses the case deadline', async function (scope: TestScope) {
        const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const engine = createTimedTestEngine(clock);
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [
                engine.createTestCase({
                    ...metadata,
                    controls: { timeoutMilliseconds: 5 },
                    title: 'slow',
                    body(inner) {
                        inner.assert.equal(1, 1);
                        clock.advanceByMilliseconds(20);
                        return inner.assert.collect();
                    }
                })
            ]
        }));
        const result = await engine.execute(plan, {
            ...options,
            timeoutPolicy: { hardTimeoutMilliseconds: 100, timeoutMilliseconds: 10 }
        });
        scope.assert.equal(result.perTest[0]?.verdict, 'fail');
        scope.assert.equal(artifactFrom(result).payload.stats.softTimeoutHeadroomMs, -15);
        return scope.assert.collect();
    }),
    test('concurrency metadata includes ordinary cases outside the debug scope', async function (scope: TestScope) {
        const engine = createTestEngine();
        const release = Promise.withResolvers<undefined>();
        const started = Promise.withResolvers<undefined>();
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [
                engine.createTestCase({
                    ...metadata,
                    title: 'debugged',
                    async body(inner) {
                        started.resolve(undefined);
                        await release.promise;
                        inner.assert.equal(1, 1);
                        return inner.assert.collect();
                    }
                }),
                engine.createTestCase({
                    ...metadata,
                    title: 'ordinary',
                    async body(inner) {
                        await started.promise;
                        release.resolve(undefined);
                        inner.assert.equal(1, 1);
                        return inner.assert.collect();
                    }
                })
            ]
        }));
        const result = await engine.execute(plan, {
            ...options,
            execution: { mode: 'concurrent-in-process', maxConcurrency: 2 },
            debug: { mode: 'selected', work: [ plan.cases[0].workId ] }
        });
        const reading = artifactFrom(result).payload.cpuTimeMs;
        scope.assert.equal(result.perTest.length, 2);
        scope.assert.equal(result.artifacts.filter(isTestDebugArtifact).length, 1);
        scope.assert.equal(
            reading.availability === 'available' && reading.overlappingWork.some(function ordinary(work) {
                return work.case.title === 'ordinary';
            }),
            true
        );
        return scope.assert.collect();
    }),
    test('recording truncation is bounded and explicit', async function (scope: TestScope) {
        const engine = createTestEngine();
        const text = 'x'.repeat(16_384);
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [
                engine.createTestCase({
                    ...metadata,
                    title: 'bounded',
                    body(inner) {
                        inner.debug.includeRecording({
                            name: 'large',
                            recorded() {
                                return Array.from({ length: 5000 }, function event() {
                                    return text;
                                });
                            }
                        });
                        inner.assert.equal(1, 1);
                        return inner.assert.collect();
                    }
                })
            ]
        }));
        const result = await engine.execute(plan, options);
        const artifact = artifactFrom(result);
        scope.assert.equal(artifact.payload.completeness, 'truncated');
        scope.assert.equal(artifact.payload.droppedEntries > 0, true);
        scope.assert.equal(Buffer.byteLength(JSON.stringify(artifact)) <= 10_485_760, true);
        scope.assert.equal(artifact.payload.timeline.at(-1)?.kind, 'body-end');
        return scope.assert.collect();
    }),
    test('completed artifacts ignore late assertions and recording registrations', async function (scope: TestScope) {
        const engine = createTestEngine();
        let late = function noLateWork(): void {
            return undefined;
        };
        const plan = engine.createTestPlan(engine.createRoot({
            annotations: {},
            controls: {},
            title: 'root',
            children: [
                engine.createTestCase({
                    ...metadata,
                    title: 'closed',
                    body(inner) {
                        late = function lateWork() {
                            inner.assert.equal(2, 2);
                            inner.debug.includeRecording({
                                name: 'late',
                                recorded() {
                                    throw new Error('Must not read late providers.');
                                }
                            });
                        };
                        inner.assert.equal(1, 1);
                        return inner.assert.collect();
                    }
                })
            ]
        }));
        const result = await engine.execute(plan, options);
        const encoded = JSON.stringify(artifactFrom(result));
        late();
        scope.assert.equal(JSON.stringify(artifactFrom(result)), encoded);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
