import type { ParameterizedTestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, suite } from '@overkill-dev/test';

import type { RunResult } from '../../packages/engine/engine.entry-point.ts';
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

const verifyCorpus = defineCompositeAssertion({
    name: 'verify corpus',
    async assert(check, project: ReplayProject, file: string) {
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
        const initialChecks = check.group([
            check.equal(result.summary.failed, 1),
            check.deepEqual(result.runnerErrors, [])
        ]);
        const evidence = result.perTest[0]?.property?.invocations[0];
        if (evidence === undefined || evidence === null) {
            return check.group([ initialChecks, check.defined(evidence) ]);
        }
        const intermediateChecks = check.defined(evidence);
        if (evidence.summary === undefined || evidence.summary === null) {
            return check.group([ initialChecks, intermediateChecks, check.defined(evidence.summary) ]);
        }
        return check.group([
            initialChecks,
            intermediateChecks,
            check.defined(evidence.summary),
            check.true(evidence.summary.accounting.phases['checked-in-corpus'].executed > 0)
        ]);
    }
});

const verifyReplay = defineCompositeAssertion({
    name: 'verify replay',
    async assert(check, project: ReplayProject, file: string, fixed: boolean) {
        const result = await orchestrator.replayWitness({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            path: file,
            profile: 'cases'
        });
        const initialChecks = check.group([
            check.deepEqual(result.runnerErrors, []),
            check.equal(result.summary.failed, fixed ? 0 : 1),
            check.equal(result.summary.passed, fixed ? 1 : 0),
            check.false(JSON.stringify(result).includes('unexpected generation')),
            check.false(JSON.stringify(result).includes('corrupted input'))
        ]);
        const cli = await executeReplayCli(project, [ 'replay-witness', file, '--profile', 'cases' ]);
        return check.group([ initialChecks, check.equal(cli.code, fixed ? 0 : 1) ]);
    }
});

const assertUnconfirmedInputs = defineCompositeAssertion({
    name: 'unconfirmed inputs',
    async assert(check, result: RunResult, project: ReplayProject) {
        const evidence = result.perTest[0]?.property?.invocations[0];
        if (evidence === undefined || evidence === null) {
            return check.defined(evidence);
        }
        const initialChecks = check.group([
            check.defined(evidence),
            check.equal(evidence.shrinkStatus, 'non-reproducible'),
            check.equal(evidence.confirmedWitness, null)
        ]);
        const files = await readdir(path.join(project.cwd, '.overkill'), { recursive: true });
        return check.group([
            initialChecks,
            check.false(files.some(function witness(file) {
                return file.endsWith('.witness.json');
            })),
            check.false(files.some(function corpus(file) {
                return file.includes('corpus');
            }))
        ]);
    }
});

export const testNode = suite(
    'runner linearizability contracts',
    [
        table({
            title: 'replays linearizability inputs',
            cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function executionMode(processModel) {
                return [ false, true ].map(function composition(nested) {
                    return { processModel, nested };
                });
            }),
            caseTitle({ processModel, nested }) {
                return [ processModel, nested ? 'nested' : 'direct' ].map(String).join(', ');
            },
            async test(
                scope: ParameterizedTestScope<
                    { readonly processModel: 'in-process' | 'supervised-process'; readonly nested: boolean; }
                >
            ) {
                const { processModel, nested } = scope.parameters;

                const project = await replayProject(scope.cleanup, {
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

                await writeReplayCase(project, linearizabilitySource(nested, 'capture'));
                const captureWitnessCaptured = await orchestrator.run(project.command);
                scope.assert.equal(captureWitnessCaptured.summary.failed, 1);
                scope.assert.deepEqual(captureWitnessCaptured.runnerErrors, []);
                const captureWitnessWitness = captureWitnessCaptured
                    .perTest[0]
                    ?.property
                    ?.invocations[0]
                    ?.confirmedWitness;
                scope.require.defined(captureWitnessWitness);
                const captureWitnessFile = path.join(project.cwd, 'linearizability.witness.json');
                await writeFile(captureWitnessFile, JSON.stringify(captureWitnessWitness));
                const file = captureWitnessFile;

                await writeReplayCase(project, linearizabilitySource(nested, 'replay'));
                await scope.assert(verifyCorpus, project, file);
                await scope.assert(verifyReplay, project, file, false);
                await writeReplayCase(project, linearizabilitySource(nested, 'fixed'));
                await scope.assert(verifyReplay, project, file, true);
                return scope.assert.collect();
            }
        }),
        table({
            title: 'does not persist unconfirmed inputs',
            cases: [ 'in-process', 'supervised-process' ] as const,
            caseTitle(processModel) {
                return processModel;
            },
            async test(scope) {
                const processModel = scope.parameters;

                const project = await replayProject(scope.cleanup, {
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
                await scope.assert(assertUnconfirmedInputs, result, project);
                return scope.assert.collect();
            }
        })
    ]
);
