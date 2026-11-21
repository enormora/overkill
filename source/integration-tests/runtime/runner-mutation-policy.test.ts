import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite } from '@overkill-dev/test';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';

import { normalizeConfig } from '../../packages/run/config.entry-point.ts';
import {
    orchestrator,
    type MicrotestProfileConfig,
    type ResolvedRun,
    type RunCommand,
    type FrozenRunCommand
} from '../../packages/run/run.entry-point.ts';
import { createMutationRunCommand } from '../../packages/stryker-runner/mutation-execution-policy.ts';

const fixture = 'source/integration-tests/runtime/fixtures/mutation-policy.test.ts';

function mutationCommand(processModel: MicrotestProfileConfig['execution']['processModel']): RunCommand {
    const config = normalizeConfig({
        loader: { sourceMaps: true, stripMode: 'strip-only' },
        profiles: {
            unit: {
                testFamily: 'microtest',
                files: {
                    sets: {
                        policy: {
                            include: [ 'source/integration-tests/runtime/fixtures/mutation-*.test.ts' ],
                            exclude: [ 'source/integration-tests/runtime/fixtures/mutation-excluded.test.ts' ]
                        }
                    }
                },
                execution: { processModel, scheduling: 'concurrent', maxConcurrency: 3 },
                coverage: { outputs: [ 'json' ] },
                processUsage: { measure: true },
                timeouts: { collectionMilliseconds: 5000, softMilliseconds: 1000, hardMilliseconds: 2000 }
            }
        },
        runtimeStateDir: 'target/mutation-policy-state'
    });

    return createMutationRunCommand({ config, cwd: process.cwd(), profile: 'unit' });
}

const assertDiscoveredPolicy = defineCompositeAssertion({
    name: 'discovered policy',
    assert(check, resolved: ResolvedRun) {
        return check.group([
            check.deepEqual(
                resolved.facts.cases.map(function discoveredFile(testCase) {
                    return testCase.id.file;
                }),
                [ fixture, fixture, fixture, fixture ]
            ),
            check.true(resolved.facts.cases.every(function namedFileSet(testCase) {
                return testCase.fileSet === 'policy';
            }))
        ]);
    }
});

const assertSerialResults = defineCompositeAssertion({
    name: 'serial results',
    assert(check, result: RunResult) {
        return check.group([
            check.equal(result.summary.passed, 2),
            check.equal(result.summary.failed, 1),
            check.equal(result.summary.runtimePolicy, 1),
            check.true(result.runnerErrors.every(function onlyPolicyErrors(error) {
                return error.subtype === 'runtime-policy';
            })),
            check.true(result.perTest.every(function singleAttempt(testCase) {
                return testCase.attempts.length === 1;
            })),
            check.equal(result.artifacts.length, 0),
            check.notEqual(result.processUsage, null)
        ]);
    }
});

async function mutationInput(command: RunCommand, frozen: boolean): Promise<FrozenRunCommand | RunCommand> {
    if (!frozen) {
        return command;
    }
    const policy = await orchestrator.freezePolicy({ moduleBoundary: null, command, source: { kind: 'memory' } });
    return {
        kind: 'frozen-policy',
        policy,
        reporting: command.config,
        invocation: { seed: { value: 11n }, selection: { kind: 'all' } }
    };
}

export const testNode = suite(
    'mutation execution policy through the public runner',
    [ table({
        title: 'serial cases and cleanup preserve execution',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function mutationProcessModel(processModel) {
            return [ false, true ].map(function frozenPolicy(frozen) {
                return { processModel, frozen };
            });
        }),
        caseTitle({ processModel, frozen }) {
            return [ frozen ? 'frozen' : 'configured', processModel ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, frozen } = scope.parameters;

            const command = mutationCommand(processModel);
            const input = await mutationInput(
                { ...command, request: { ...command.request, order: 'lexical' } },
                frozen
            );
            const resolved = await orchestrator.resolve(input);
            const result = await orchestrator.run(input);

            scope.assert.equal(resolved.facts.execution.processModel, processModel);
            scope.assert(assertDiscoveredPolicy, resolved);
            scope.assert(assertSerialResults, result);
            return scope.assert.collect();
        }
    }) ]
);
