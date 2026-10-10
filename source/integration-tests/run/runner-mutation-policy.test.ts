import {
    createSuite,
    createTestCase,
    type RunResult,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import { normalizeConfig } from '../../packages/run/config.entry-point.ts';
import {
    orchestrator,
    type MicrotestProfileConfig,
    type ResolvedRun,
    type RunCommand
} from '../../packages/run/run.entry-point.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { createMutationRunCommand } from '../../packages/stryker-runner/mutation-execution-policy.ts';
import { runIfMain } from '../direct-launcher.test.ts';

const fixture = 'source/integration-tests/run/fixtures/mutation-policy.test.ts';
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

function mutationCommand(processModel: MicrotestProfileConfig['execution']['processModel']): RunCommand {
    const config = normalizeConfig({
        loader: { sourceMaps: true, stripMode: 'strip-only' },
        profiles: {
            unit: {
                testFamily: 'microtest',
                files: {
                    sets: {
                        policy: {
                            include: [ 'source/integration-tests/run/fixtures/mutation-*.test.ts' ],
                            exclude: [ 'source/integration-tests/run/fixtures/mutation-excluded.test.ts' ]
                        }
                    }
                },
                execution: { processModel, scheduling: 'concurrent', maxConcurrency: 3 },
                coverage: { outputs: [ 'json' ] },
                resourceUsage: { measure: true },
                timeouts: { collectionMilliseconds: 5000, softMilliseconds: 1000, hardMilliseconds: 2000 }
            }
        },
        runtimeStateDir: 'target/mutation-policy-state'
    });

    return createMutationRunCommand({ config, cwd: process.cwd(), profile: 'unit' });
}

function assertDiscoveredPolicy(scope: TestScope, resolved: ResolvedRun): void {
    scope.assert.deepEqual(
        resolved.facts.cases.map(function discoveredFile(testCase) {
            return testCase.id.file;
        }),
        [ fixture, fixture, fixture, fixture ]
    );
    scope.assert.true(resolved.facts.cases.every(function namedFileSet(testCase) {
        return testCase.fileSet === 'policy';
    }));
}

function assertSerialResults(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.passed, 2);
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.equal(result.summary.runtimePolicy, 1);
    scope.assert.true(result.runnerErrors.every(function onlyPolicyErrors(error) {
        return error.subtype === 'runtime-policy';
    }));
    scope.assert.true(result.perTest.every(function singleAttempt(testCase) {
        return testCase.attempts.length === 1;
    }));
    scope.assert.equal(result.artifacts.length, 0);
    scope.assert.notEqual(result.resourceUsage, null);
}

export const testNode = createSuite({
    title: 'mutation execution policy through the public runner',
    ...metadata,
    children: ([ 'in-process', 'supervised-process' ] as const).map(function mutationProcessModel(processModel) {
        return createTestCase({
            title: `serial cases and cleanup preserve ${processModel} execution`,
            ...metadata,
            async body(scope: TestScope) {
                const command = mutationCommand(processModel);
                const resolved = await orchestrator.resolve(command);
                const result = await orchestrator.run({
                    ...command,
                    request: { ...command.request, order: 'lexical' }
                });

                scope.assert.equal(resolved.facts.execution.processModel, processModel);
                assertDiscoveredPolicy(scope, resolved);
                assertSerialResults(scope, result);
                return scope.assert.collect();
            }
        });
    })
});

await runIfMain(import.meta, testNode, [ createLineReporter() ]);
