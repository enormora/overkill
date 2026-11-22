import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import {
    normalizeConfig,
    orchestrator,
    parseRunnerResult,
    type RunCommand,
    type BenchmarkGarbageCollectionPolicy
} from '../../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { assertModuleBenchmark, assertFailedTimeline } from './support/module-import-assertions.ts';

function hostedModuleCommand(command: RunCommand): RunCommand {
    const profile = command.config.profiles.imports;
    if (profile?.testFamily !== 'benchmark' || profile.execution.processModel !== 'worker-pool') {
        throw new Error('Missing module benchmark profile.');
    }
    return {
        ...command,
        config: {
            ...command.config,
            profiles: {
                imports: {
                    ...profile,
                    execution: { ...profile.execution, hostProcess: { kind: 'child', nodeArguments: [] } }
                }
            }
        }
    };
}

async function commandFor(
    cleanup: TestScope['cleanup'],
    boundary: 'fresh-worker-per-unit' | 'hosted' | 'reuse' | 'supervised-process',
    filename: string,
    garbageCollection: BenchmarkGarbageCollectionPolicy
): Promise<RunCommand> {
    const directory = await mkdtemp(join(tmpdir(), 'overkill-module-'));
    cleanup(async function () {
        await rm(directory, { recursive: true, force: true });
    });
    const command: RunCommand = {
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'imports' }),
        config: normalizeConfig({
            runtimeStateDir: directory,
            profiles: {
                imports: {
                    testFamily: 'benchmark',
                    garbageCollection,
                    files: { include: [ filename ] },
                    timeouts: { collectionMilliseconds: 30_000 },
                    execution: boundary === 'supervised-process'
                        ? { processModel: 'supervised-process' }
                        : {
                            processModel: 'worker-pool',
                            workerLifecycle: boundary === 'hosted' ? 'reuse' : boundary
                        }
                }
            }
        })
    };
    return boundary === 'hosted' ? hostedModuleCommand(command) : command;
}

const boundaries = [ 'reuse', 'fresh-worker-per-unit', 'supervised-process', 'hosted' ] as const;
export const testNode = suite(
    'cold module imports',
    [
        test(
            'retains failed bodies, cleanup, and forced GC in a partial timeline',
            async function (scope) {
                const command = await commandFor(
                    scope.cleanup,
                    'reuse',
                    'source/integration-tests/runtime/fixtures/timeline-failure.bench.test.ts',
                    'off'
                );
                scope.assert(assertFailedTimeline, await orchestrator.bench.run(command, { timing: null }));
                return scope.assert.collect();
            }
        ),
        test('rejects host GC for cold imports before measuring', async function (scope) {
            const command = await commandFor(
                scope.cleanup,
                'hosted',
                'source/integration-tests/runtime/fixtures/cold-import.bench.test.ts',
                'after-sample'
            );
            const result = await orchestrator.bench.run(command, { timing: null });
            scope.assert.equal(result.summary.passed, 0);
            scope.assert.true(result.runnerErrors.length > 0);
            for (const error of result.runnerErrors) {
                scope.assert.partialDeepEqual(error, {
                    subtype: 'measurement',
                    message: 'The external measured process does not expose target settling or GC capabilities.'
                });
            }
            scope.assert.partialDeepEqual(result.perTest[0]?.benchmark ?? {}, { samples: 0, status: 'incomplete' });
            return scope.assert.collect();
        }),
        table({
            title: 'imports fresh module graphs',
            cases: boundaries.map(
                function boundary(value) {
                    const selected = value;
                    return { selected };
                }
            ),
            caseTitle({ selected }) {
                return [ selected ].map(String).join(', ');
            },
            async test(scope) {
                const command = await commandFor(
                    scope.cleanup,
                    scope.parameters.selected,
                    'source/integration-tests/runtime/fixtures/cold-import.bench.test.ts',
                    'off'
                );
                const listed = await orchestrator.bench.list(command, { timing: null });
                if (listed.plan.kind === 'local') {
                    throw new Error('Expected isolated module plan.');
                }
                scope.assert.equal(
                    listed.plan.collectedPlan.files[0]?.cases[0]?.benchmark?.measurement.mode,
                    'module'
                );
                const result = await orchestrator.bench.run(command, { timing: null });
                scope.assert(assertModuleBenchmark, result);
                const serialized = JSON.stringify(result);
                scope.assert(assertModuleBenchmark, parseRunnerResult(JSON.parse(serialized)));
                return scope.assert.collect();
            }
        })
    ]
);
