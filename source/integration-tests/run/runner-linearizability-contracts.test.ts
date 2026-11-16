import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import type { RunResult } from '../../packages/engine/engine.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    type ReplayProject,
    replayProject,
    writeReplayCase,
    executeReplayCli,
    replayAuthoringUrl,
    replayPropertyUrl
} from '../../test-support/replay-project-fixture.ts';

const linearizabilityEntryPoint = new URL(
    '../../packages/linearizability/linearizability.entry-point.ts',
    import.meta.url
);
const linearizabilityUrl = linearizabilityEntryPoint.href;

function linearizabilitySource(nested: boolean, mode: 'capture' | 'fixed' | 'replay' | 'unstable'): string {
    const invocation = `{
        generator: gen.constant(null).map(() => { throw new Error('unexpected generation'); }),
        examples: ${mode === 'capture' || mode === 'unstable' ? '[graph]' : '[]'},
        test: linearizability({
            create(sample) {
                attempts += 1;
                const seen = [];
                sample.cleanup(() => {
                    if (JSON.stringify(seen) !== '[7,8,9]') throw new Error('corrupted lane execution');
                });
                return seen;
            },
            run(operation, seen) {
                seen.push(operation.value);
                operation.value = -1;
                return ${{ capture: '1', replay: '1', fixed: '0', unstable: '(attempts === 1 ? 1 : 0)' }[mode]};
            },
            model: {
                initial: () => 0,
                transition(state, observation) {
                    if (observation.operation.value < 7) throw new Error('corrupted model input');
                    return observation.outcome.kind === 'returned' && observation.outcome.value === state
                        ? {kind: 'enabled', state} : {kind: 'disabled'};
                }
            },
            maxWork: 1000
        })
    }`;
    const declaration = nested
        ? `test('linearizability contract', withProperties(async parent => {
            return await parent.forall({key: 'comparison', ...${invocation}});
        }))`
        : `property({title: 'linearizability contract', ...${invocation}})`;
    return `import {linearizability} from ${JSON.stringify(linearizabilityUrl)};
import {gen, property, withProperties} from ${JSON.stringify(replayPropertyUrl)};
import {test} from ${JSON.stringify(replayAuthoringUrl)};
let attempts = 0;
function graph() {
    return [[{value: 7}, {value: 9}], [{value: 8}]];
}
export const testNode = ${declaration};`;
}

async function captureWitness(scope: TestScope, project: ReplayProject, nested: boolean): Promise<string> {
    await writeReplayCase(project, linearizabilitySource(nested, 'capture'));
    const captured = await orchestrator.run(project.command);
    scope.assert.equal(captured.summary.failed, 1);
    scope.assert.deepEqual(captured.runnerErrors, []);
    const witness = captured.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    scope.require.defined(witness);
    const file = path.join(project.cwd, 'linearizability.witness.json');
    await writeFile(file, JSON.stringify(witness));
    return file;
}

async function verifyCorpus(scope: TestScope, project: ReplayProject, file: string): Promise<void> {
    const profile = project.command.config.profiles.cases;
    if (profile?.testFamily !== 'property') {
        throw new TypeError('Expected property profile.');
    }
    const result = await orchestrator.run({
        ...project.command,
        config: {
            ...project.command.config,
            profiles: {
                cases: {
                    ...profile,
                    corpus: { ...profile.corpus, checkedIn: [ file ] }
                }
            }
        }
    });
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.require.defined(evidence.summary);
    scope.assert.true(evidence.summary.accounting.phases['checked-in-corpus'].executed > 0);
}

async function verifyReplay(scope: TestScope, project: ReplayProject, file: string, fixed: boolean): Promise<void> {
    const result = await orchestrator.replayWitness({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.equal(result.summary.failed, fixed ? 0 : 1);
    scope.assert.equal(result.summary.passed, fixed ? 1 : 0);
    scope.assert.false(JSON.stringify(result).includes('unexpected generation'));
    scope.assert.false(JSON.stringify(result).includes('corrupted input'));
    const cli = await executeReplayCli(project, [ 'replay-witness', file, '--profile', 'cases' ]);
    scope.assert.equal(cli.code, fixed ? 0 : 1);
}

async function assertUnconfirmedInputs(scope: TestScope, result: RunResult, project: ReplayProject): Promise<void> {
    const evidence = result.perTest[0]?.property?.invocations[0];
    scope.require.defined(evidence);
    scope.assert.equal(evidence.shrinkStatus, 'non-reproducible');
    scope.assert.equal(evidence.confirmedWitness, null);
    const files = await readdir(path.join(project.cwd, '.overkill'), { recursive: true });
    scope.assert.false(files.some(function witness(file) {
        return file.endsWith('.witness.json');
    }));
    scope.assert.false(files.some(function corpus(file) {
        return file.includes('corpus');
    }));
}

export const testNode = suite(
    'runner linearizability contracts',
    [
        ...([ 'in-process', 'supervised-process' ] as const).flatMap(function executionMode(processModel) {
            return [ false, true ].map(function composition(nested) {
                return test(
                    `${processModel} replays ${nested ? 'nested' : 'direct'} linearizability inputs`,
                    async function (scope: TestScope) {
                        const project = await replayProject(scope, {
                            testFamily: 'property',
                            files: { include: [ 'case.test.ts' ] },
                            execution: { processModel, scheduling: 'serial' },
                            property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
                            timeouts: {
                                collectionMilliseconds: 30_000,
                                softMilliseconds: 5000,
                                hardMilliseconds: 10_000
                            }
                        });
                        const file = await captureWitness(scope, project, nested);
                        await writeReplayCase(project, linearizabilitySource(nested, 'replay'));
                        await verifyCorpus(scope, project, file);
                        await verifyReplay(scope, project, file, false);
                        await writeReplayCase(project, linearizabilitySource(nested, 'fixed'));
                        await verifyReplay(scope, project, file, true);
                        return scope.assert.collect();
                    }
                );
            });
        }),
        ...([ 'in-process', 'supervised-process' ] as const).map(function unstable(processModel) {
            return test(`${processModel} does not persist unconfirmed inputs`, async function (scope: TestScope) {
                const project = await replayProject(scope, {
                    testFamily: 'property',
                    files: { include: [ 'case.test.ts' ] },
                    execution: { processModel, scheduling: 'serial' },
                    property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
                    timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                });
                await writeReplayCase(project, linearizabilitySource(false, 'unstable'));
                const result = await orchestrator.run(project.command);
                scope.assert.equal(result.summary.failed, 1);
                scope.assert.deepEqual(result.runnerErrors, []);
                await assertUnconfirmedInputs(scope, result, project);
                return scope.assert.collect();
            });
        })
    ]
);
await runIfMain(import.meta, testNode);
