import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import { copyConfig } from '../config/snapshot.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { copyRunEngineSelection, runEngineFacts } from './run-support.ts';
import { copyRunRequest } from './request-snapshot.ts';

const reporter = defineReporter(function createRunSupportReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'run-support',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-support.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'copyConfig() preserves profile behavior while copying mutable containers',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const config = defaultRunConfig({
                    profiles: {
                        integration: defaultIntegrationProfile({
                            files: {
                                sets: {
                                    smoke: {
                                        exclude: [ 'source/slow/**' ],
                                        include: [ 'source/**/*.test.ts' ]
                                    }
                                }
                            },
                            reporters: [ reporter ]
                        }),
                        microtest: defaultMicrotestProfile({
                            files: {
                                exclude: [ 'source/fixtures/**' ],
                                include: [ 'source/**/*.test.ts' ]
                            },
                            reporters: null
                        })
                    },
                    reporters: [ reporter ]
                });
                const copied = copyConfig(config);

                scope.assert.deepEqual(copied, config);
                scope.assert.notEqual(copied.profiles, config.profiles);
                scope.assert.notEqual(copied.reporters, config.reporters);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'copyRunRequest() copies resource overrides and debug selectors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const request = defaultRunRequest({
                    debug: {
                        mode: 'off',
                        selectors: []
                    },
                    resourceBudgetOverrides: {
                        activeResourceCount: 1,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    }
                });
                const copied = copyRunRequest(request);

                scope.assert.deepEqual(copied, request);
                scope.assert.notEqual(copied.paths, request.paths);
                scope.assert.notEqual(copied.resourceBudgetOverrides, request.resourceBudgetOverrides);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'copyConfig() rejects integration profiles without file discovery',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const config = defaultRunConfig({
                    profiles: {
                        integration: {
                            ...defaultIntegrationProfile({
                                files: {
                                    exclude: [],
                                    include: [ 'source/**/*.test.ts' ]
                                }
                            }),
                            files: null
                        }
                    }
                } as unknown as Partial<NormalizedConfig>);

                scope.assert.throws(function copyInvalidConfig() {
                    copyConfig(config);
                }, { message: 'Integration profiles require files.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run engine helpers preserve instance and module identities',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const instanceEngine = { engine: defaultRunEngine, kind: 'instance' as const };
                const moduleEngine = {
                    exportKind: 'getter' as const,
                    exportName: 'createEngine',
                    kind: 'module' as const,
                    moduleUrl: 'file:///project/engine.ts'
                };

                scope.assert.deepEqual(copyRunEngineSelection(instanceEngine), instanceEngine);
                scope.assert.deepEqual(copyRunEngineSelection(moduleEngine), moduleEngine);
                scope.assert.deepEqual(copyRunEngineSelection({ kind: 'default' }), { kind: 'default' });
                scope.assert.deepEqual(runEngineFacts(instanceEngine), { kind: 'instance' });
                scope.assert.deepEqual(runEngineFacts(moduleEngine), moduleEngine);
                scope.assert.deepEqual(runEngineFacts({ kind: 'default' }), { kind: 'default' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
