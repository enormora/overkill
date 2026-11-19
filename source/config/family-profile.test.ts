import { runIfMain } from '#test-runner';
import { z } from 'zod/v4';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { defineTestFamily, type TestFamily } from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { normalizeConfig } from './config.ts';
import { copyConfig } from './snapshot.ts';
import { validateNormalizedConfig } from './validation.ts';

function runtimeFamily(record: (event: string) => void): TestFamily<{ readonly count: number; }> {
    return defineTestFamily({
        id: '@example/runtime',
        version: '1',
        module: null,
        features: { execution: 'runtime', processModels: [ 'in-process' ], profileOptions: [] },
        parseSettings(input) {
            const settings = z.strictObject({ count: z.number() }).parse(input);
            return { count: settings.count + 1 };
        },
        async load() {
            record('load');
            return {
                async prepare(input) {
                    record(`prepare:${input.settings.count}`);
                    return {
                        testPlan: input.testPlan,
                        facts: null,
                        async dispose() {
                            record('dispose');
                        },
                        async collect() {
                            record('collect');
                            return { kind: 'runtime', facts: null };
                        }
                    };
                }
            };
        }
    });
}

async function prepareDirectFamily(family: TestFamily<{ readonly count: number; }>): Promise<void> {
    const engine = createTestEngine();
    const nodeOptions = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] as const };
    const testPlan = engine.createTestPlan(engine.createRoot({
        ...nodeOptions,
        title: 'root',
        children: [ engine.createTestCase({
            ...nodeOptions,
            title: 'case',
            body(testScope) {
                return testScope.assert.collect();
            }
        }) ]
    }));
    const { signal } = new AbortController();
    await using prepared = await engine.prepareFamily({
        testPlan,
        testFamily: family,
        settings: { count: 3 },
        projectRoot: '/project',
        signal
    });
    await prepared.collect({
        workIds: prepared.testPlan.cases.map(function identity(testCase) {
            return testCase.workId;
        }),
        signal
    });
}

async function repeatFamilyProfile(family: TestFamily<{ readonly count: number; }>): Promise<readonly string[]> {
    const config = copyConfig(normalizeConfig({
        profiles: {
            custom: {
                testFamily: family,
                settings: { count: 3 },
                files: { include: [ 'source/test.test.ts' ] },
                execution: { processModel: 'in-process' }
            }
        }
    }));
    validateNormalizedConfig(config);
    const coordinator = createDeterministicRunCoordinator();
    const initialized = await coordinator.orchestrator.initialize({
        config,
        cwd: '/project',
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'custom', paths: [ 'source/test.test.ts' ] })
    });
    const collected = await initialized.collect();
    const first = await collected.run({ selection: { kind: 'all' } });
    const second = await collected.run({ selection: { kind: 'all' } });
    return [ first.status, second.status ];
}

export const testNode = suite('imported family profiles', [
    ...[ {}, { count: 'three' }, { project: './tsconfig.json' } ].map(function invalidSettings(settings) {
        return test(`rejects untyped settings ${JSON.stringify(settings)} without loading`, function (scope) {
            const events: string[] = [];
            const family = runtimeFamily(function (event) {
                events.push(event);
            });
            scope.assert.throws(function () {
                return normalizeConfig({
                    profiles: {
                        custom: {
                            testFamily: family,
                            settings,
                            files: { include: [ 'source/**/*.test.ts' ] },
                            execution: { processModel: 'in-process' }
                        }
                    }
                });
            }, { type: Error });
            scope.assert.deepEqual(events, []);
            return scope.assert.collect();
        });
    }),
    test('normalizes and snapshots definitions without loading a backend', function (scope) {
        const events: string[] = [];
        const family = runtimeFamily(function (event) {
            events.push(event);
        });
        const config = normalizeConfig({
            profiles: {
                custom: {
                    testFamily: family,
                    settings: { count: 3 },
                    files: { include: [ 'source/**/*.test.ts' ] },
                    execution: { processModel: 'in-process' }
                }
            }
        });
        validateNormalizedConfig(config);
        const snapshot = copyConfig(config);
        scope.assert.equal(snapshot.profiles.custom?.testFamily, family);
        scope.assert.deepEqual(events, []);
        scope.assert.equal(config.profiles.microtest?.testFamily, 'microtest');
        return scope.assert.collect();
    }),
    test('parses settings once for direct calls and repeated profile invocations', async function (scope) {
        const events: string[] = [];
        const family = runtimeFamily(function record(event) {
            events.push(event);
        });
        await prepareDirectFamily(family);
        scope.assert.deepEqual(await repeatFamilyProfile(family), [ 'passed', 'passed' ]);
        scope.assert.deepEqual(
            events.filter(function preparation(event) {
                return event.startsWith('prepare:');
            }),
            [ 'prepare:4', 'prepare:4', 'prepare:4', 'prepare:4' ]
        );
        return scope.assert.collect();
    }),
    test('rejects conflicting implementations before loading', function (scope) {
        const events: string[] = [];
        const files = { include: [ 'source/**/*.test.ts' ] } as const;
        scope.assert.throws(function () {
            return normalizeConfig({
                profiles: {
                    first: {
                        testFamily: runtimeFamily(function (event) {
                            events.push(event);
                        }),
                        settings: { count: 1 },
                        files,
                        execution: { processModel: 'in-process' }
                    },
                    second: {
                        testFamily: runtimeFamily(function (event) {
                            events.push(event);
                        }),
                        settings: { count: 2 },
                        files,
                        execution: { processModel: 'in-process' }
                    }
                }
            });
        }, { message: 'Conflicting family implementations: @example/runtime' });
        scope.assert.deepEqual(events, []);
        return scope.assert.collect();
    }),
    test('runs imported runtime profiles through engine preparation', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const config = normalizeConfig({
            profiles: {
                custom: {
                    testFamily: runtimeFamily(function (event) {
                        events.push(event);
                    }),
                    settings: { count: 3 },
                    files: { include: [ 'source/test.test.ts' ] },
                    execution: { processModel: 'in-process' }
                }
            }
        });
        const result = await coordinator.orchestrator.run({
            config,
            cwd: '/project',
            engine: { kind: 'default' },
            request: defaultRunRequest({ profile: 'custom', paths: [ 'source/test.test.ts' ] })
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(events, [ 'load', 'prepare:4', 'collect', 'dispose' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
