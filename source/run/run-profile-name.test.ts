import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { invalidRunProfileNameMessage, type RunCommand } from './run-types.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const validProjectProfileNames = [ 'backend-http', 'ui-browser', 'ui.browser', 'unit_fast' ];
const invalidProfileNameMessage = 'Invalid profile name "backend/http". ' +
    'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
const emptyProfileNameMessage = 'Invalid profile name "". ' +
    'Profile names may only contain letters, numbers, dots, underscores, and hyphens.';
const reservedBenchmarkProfileNameMessage = 'Invalid profile name "benchmark". ' +
    'The "benchmark" profile name is reserved for benchmark commands.';

function runCommand(profile: string, config = defaultRunConfig()): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({
            paths: [ passingFixturePath ],
            profile
        })
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-profile-name.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'profile name validation accepts project-owned names',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                for (const profileName of validProjectProfileNames) {
                    scope.assert.equal(invalidRunProfileNameMessage(profileName), null);
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'profile name validation rejects invalid and reserved names',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.equal(invalidRunProfileNameMessage('backend/http'), invalidProfileNameMessage);
                scope.assert.equal(invalidRunProfileNameMessage(''), emptyProfileNameMessage);
                scope.assert.equal(invalidRunProfileNameMessage('benchmark'), reservedBenchmarkProfileNameMessage);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() selects a project-owned profile name',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(runCommand(
                    'backend-http',
                    defaultRunConfig({
                        profiles: {
                            'backend-http': defaultMicrotestProfile({
                                execution: { processModel: 'in-process', scheduling: 'serial' },
                                timeouts: { hardMilliseconds: 2000, softMilliseconds: 750 }
                            })
                        }
                    })
                ));

                scope.assert.equal(resolvedRun.facts.execution.profile, 'backend-http');
                scope.assert.equal(resolvedRun.facts.execution.testFamily, 'microtest');
                scope.assert.equal(resolvedRun.facts.execution.processModel, 'in-process');
                scope.assert.equal(resolvedRun.facts.execution.scheduling, 'serial');
                scope.assert.deepEqual(resolvedRun.facts.execution.timeoutPolicy, {
                    collectionMilliseconds: 1000,
                    hardMilliseconds: 2000,
                    softMilliseconds: 750
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects invalid profile names',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidRequestProfileName() {
                    await runOrchestrator.resolve(runCommand('backend/http'));
                }, { message: invalidProfileNameMessage });
                await scope.assert.rejects(async function resolveInvalidConfigProfileName() {
                    await runOrchestrator.resolve(runCommand(
                        'microtest',
                        defaultRunConfig({
                            profiles: { 'backend/http': defaultMicrotestProfile() }
                        })
                    ));
                }, { message: invalidProfileNameMessage });
                await scope.assert.rejects(async function resolveReservedProfileName() {
                    await runOrchestrator.resolve(runCommand(
                        'benchmark',
                        defaultRunConfig({
                            profiles: { benchmark: defaultMicrotestProfile() }
                        })
                    ));
                }, { message: reservedBenchmarkProfileNameMessage });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
