import {
    createSuite,
    createTestCase,
    type Engine,
    type TestNode,
    type TestPlan,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createDeterministicRunCoordinator,
    createDeterministicWorkerPoolCollectionCoordinator
} from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import {
    collectedRunPlanFromTestPlan,
    runCollectionRootFromResolvedPlan
} from './collected-run-plan.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { assertDirectEntrypointCollectionMatches } from './direct-entrypoint-collection.ts';
import type { DirectEntrypointCollectionSource } from './run-collection-source.ts';
import type { RunCommand } from './run-types.ts';
import {
    createRunTestPlan,
    createRunTestPlanFromDirectEntrypoint
} from './run-test-plan.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

function passingTest(title: string): TestNode {
    return createTestCase({
        annotations: {},
        body(scope) {
            scope.assert.true(true);

            return scope.assert.collect();
        },
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title
    });
}

function testPlan(title: string): TestPlan {
    return defaultRunEngine.createTestPlanFromTestFiles({
        files: [ { file: '/project/direct.test.ts', testNode: passingTest(title) } ],
        root: { annotations: {}, controls: {}, title: '/project' }
    });
}

function throwingEngine(): Engine {
    return {
        ...defaultRunEngine,
        createTestPlanFromTestFiles() {
            throw new Error('invalid test plan');
        }
    };
}

const explicitRoot: Parameters<Engine['createTestPlanFromTestFiles']>[0]['root'] = {
    annotations: { ownership: [ '@runner' ], tags: [ 'direct' ] },
    controls: { capture: 'live', duplicateExecution: 'idempotent', timeoutMilliseconds: 17 },
    title: 'direct root'
};

function passingFixtureTestNode(): TestNode {
    return defaultRunEngine.createSuite({
        annotations: {},
        children: [
            defaultRunEngine.createTestCase({
                annotations: { tags: [ 'fast' ] },
                body(scope) {
                    scope.assert.true(true, { message: 'passes' });

                    return scope.assert.collect();
                },
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'passes'
            })
        ],
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'fixture'
    });
}

function directSource(testNode: TestNode): DirectEntrypointCollectionSource {
    return {
        kind: 'direct-entrypoint',
        root: { annotations: {}, controls: {}, title: '/project' },
        testNode
    };
}

function directCommand(profile: RunCommand['config']['profiles'][string], profileName: string): RunCommand {
    return {
        config: defaultRunConfig({ profiles: { [profileName]: profile } }),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ paths: [ passingFixturePath ], profile: profileName })
    };
}

export const testNode = createSuite({
    annotations: {},
    children: [
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                const expected = testPlan('passes');

                assertDirectEntrypointCollectionMatches(expected, collectedRunPlanFromTestPlan(expected));
                scope.assert.true(true);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint collection accepts equivalent normalized plans'
        }),
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                scope.assert.throws(function compareDifferentDirectPlans() {
                    assertDirectEntrypointCollectionMatches(
                        testPlan('expected'),
                        collectedRunPlanFromTestPlan(testPlan('exported'))
                    );
                }, {
                    message: /runIfMain\(\) argument does not match/u,
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint collection rejects different normalized plans'
        }),
        createTestCase({
            annotations: {},
            body(scope: TestScope) {
                const planned = defaultRunEngine.createTestPlanFromTestFiles({
                    files: [ { file: '/project/direct.test.ts', testNode: passingTest('passes') } ],
                    root: explicitRoot
                });

                scope.assert.deepEqual(
                    runCollectionRootFromResolvedPlan({ kind: 'local', testPlan: planned }),
                    explicitRoot
                );

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resolved local plans preserve explicit collection roots'
        }),
        createTestCase({
            annotations: {},
            async body(scope: TestScope) {
                const file = {
                    file: '/project/direct.test.ts',
                    fileSet: null,
                    href: 'virtual:direct.test.ts',
                    path: '/project/direct.test.ts'
                };

                scope.assert.throws(function collectInvalidDirectPlan() {
                    createRunTestPlanFromDirectEntrypoint(
                        throwingEngine(),
                        file,
                        directSource(passingTest('passes'))
                    );
                }, {
                    message: 'Failed to collect tests from runIfMain().',
                    name: 'RunCollectionError'
                });
                await scope.assert.rejects(async function collectInvalidConfiguredPlan() {
                    await createRunTestPlan({
                        cwd: '/project',
                        definitionLocationCapture: 'disabled',
                        discoverRunFiles: async function discoverFile() {
                            return [ file ];
                        },
                        engine: throwingEngine(),
                        loadRunTestModules: async function loadTestModule() {
                            return [ { file: file.file, testNode: passingTest('passes') } ];
                        },
                        paths: [ file.file ],
                        root: explicitRoot,
                        testFamily: 'microtest'
                    });
                }, {
                    message: 'Failed to collect tests from run inputs.',
                    name: 'RunCollectionError'
                });

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'test plan collection normalizes engine failures'
        }),
        createTestCase({
            annotations: {},
            async body(scope: TestScope) {
                const coordinator = createDeterministicRunCoordinator();
                const delivery = await coordinator.runDirectEntrypoint(
                    directCommand(defaultMicrotestProfile(), 'microtest'),
                    directSource(passingFixtureTestNode())
                );

                scope.assert.equal(delivery.result.status, 'passed');
                scope.assert.equal(delivery.result.summary.passed, 1);
                scope.assert.deepEqual(delivery.result.runnerErrors, []);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint runner preserves supervised execution'
        }),
        createTestCase({
            annotations: {},
            async body(scope: TestScope) {
                const coordinator = createDeterministicRunCoordinator();
                const delivery = await coordinator.runDirectEntrypoint(
                    directCommand(
                        defaultMicrotestProfile({
                            execution: { processModel: 'in-process' }
                        }),
                        'microtest'
                    ),
                    directSource(passingFixtureTestNode())
                );

                scope.assert.equal(delivery.result.status, 'passed');
                scope.assert.equal(delivery.result.summary.passed, 1);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint runner preserves in-process execution'
        }),
        createTestCase({
            annotations: {},
            async body(scope: TestScope) {
                const coordinator = createDeterministicRunCoordinator();
                const delivery = await coordinator.runDirectEntrypoint(
                    directCommand(defaultMicrotestProfile(), 'microtest'),
                    directSource(passingTest('different'))
                );
                const [ error ] = delivery.result.runnerErrors;

                scope.require.defined(error);
                scope.assert.match(error.message, /runIfMain\(\) argument does not match/u);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint runner rejects mismatched isolated collection'
        }),
        createTestCase({
            annotations: {},
            async body(scope: TestScope) {
                const coordinator = createDeterministicWorkerPoolCollectionCoordinator();
                const delivery = await coordinator.runDirectEntrypoint(
                    directCommand(defaultIntegrationProfile({}), 'integration'),
                    directSource(passingTest('different'))
                );
                const [ error ] = delivery.result.runnerErrors;

                scope.require.defined(error);
                scope.assert.match(error.message, /runIfMain\(\) argument does not match/u);

                return scope.assert.collect();
            },
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'direct entrypoint runner validates worker-pool collection'
        })
    ],
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/direct-entrypoint-collection.test.ts'
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
