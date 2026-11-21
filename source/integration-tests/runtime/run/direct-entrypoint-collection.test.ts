import { suite, test, type TestScope } from '@overkill-dev/test';

import {
    type Engine,
    type TestNode as SubjectTestNode,
    type TestPlan,
    createTestCase
} from '../../../packages/engine/engine.entry-point.ts';

import {
    createDeterministicRunCoordinator,
    createDeterministicWorkerPoolCollectionCoordinator
} from '../../../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../../../test-support/run-command-factory.ts';
import { collectedRunPlanFromTestPlan, runCollectionRootFromResolvedPlan } from '../../../run/collected-run-plan.ts';
import { defaultRunEngine } from '../../../run/default-run-engine.ts';
import { assertDirectEntrypointCollectionMatches } from '../../../run/direct-entrypoint-collection.ts';
import type { DirectEntrypointCollectionSource } from '../../../run/run-collection-source.ts';
import type { RunCommand } from '../../../run/run-types.ts';
import { createRunTestPlan, createRunTestPlanFromDirectEntrypoint } from '../../../run/run-test-plan.ts';

const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

function passingTest(title: string): SubjectTestNode {
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

function passingFixtureTestNode(): SubjectTestNode {
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

function directSource(testNode: SubjectTestNode): DirectEntrypointCollectionSource {
    return {
        kind: 'direct-entrypoint',
        configuration: { kind: 'memory' },
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

export const testNode = suite('Direct entrypoint collection', [
    test('accepts equivalent normalized plans', function (scope) {
        const expected = testPlan('passes');

        assertDirectEntrypointCollectionMatches(expected, collectedRunPlanFromTestPlan(expected));
        scope.assert.true(true);

        return scope.assert.collect();
    }),
    test('rejects different normalized plans', function (scope) {
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
    }),
    test('resolved local plans preserve explicit collection roots', function (scope) {
        const planned = defaultRunEngine.createTestPlanFromTestFiles({
            files: [ { file: '/project/direct.test.ts', testNode: passingTest('passes') } ],
            root: explicitRoot
        });

        scope.assert.deepEqual(
            runCollectionRootFromResolvedPlan({ kind: 'local', testPlan: planned }),
            explicitRoot
        );

        return scope.assert.collect();
    }),
    test('test plan collection normalizes engine failures', async function (scope) {
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
                replay: null,
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
    }),
    test('direct entrypoint runner preserves supervised execution', async function (scope) {
        const coordinator = createDeterministicRunCoordinator();
        const delivery = await coordinator.runDirectEntrypoint(
            directCommand(defaultMicrotestProfile(), 'microtest'),
            directSource(passingFixtureTestNode())
        );

        scope.assert.equal(delivery.result.status, 'passed');
        scope.assert.equal(delivery.result.summary.passed, 1);
        scope.assert.deepEqual(delivery.result.runnerErrors, []);

        return scope.assert.collect();
    }),
    test('direct entrypoint runner preserves in-process execution', async function (scope) {
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
    }),
    test('direct entrypoint runner rejects mismatched isolated collection', async function (scope: TestScope) {
        const coordinator = createDeterministicRunCoordinator();
        const delivery = await coordinator.runDirectEntrypoint(
            directCommand(defaultMicrotestProfile(), 'microtest'),
            directSource(passingTest('different'))
        );
        const [ error ] = delivery.result.runnerErrors;

        scope.require.defined(error);
        scope.assert.match(error.message, /runIfMain\(\) argument does not match/u);

        return scope.assert.collect();
    }),
    test('direct entrypoint runner validates worker-pool collection', async function (scope: TestScope) {
        const coordinator = createDeterministicWorkerPoolCollectionCoordinator();
        const delivery = await coordinator.runDirectEntrypoint(
            directCommand(defaultIntegrationProfile({}), 'integration'),
            directSource(passingTest('different'))
        );
        const [ error ] = delivery.result.runnerErrors;

        scope.require.defined(error);
        scope.assert.match(error.message, /runIfMain\(\) argument does not match/u);

        return scope.assert.collect();
    })
]);
