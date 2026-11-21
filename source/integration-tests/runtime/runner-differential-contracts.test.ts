import type { ParameterizedTestScope } from '@overkill-dev/test';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, suite } from '@overkill-dev/test';

import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    type ReplayProject,
    replayProject,
    writeReplayCase,
    executeReplayCli,
    replayAuthoringUrl,
    replayPropertyUrl
} from '../../test-support/replay-project-fixture.ts';

const differentialEntryPoint = new URL('../../packages/differential/differential.entry-point.ts', import.meta.url);
const differentialUrl = differentialEntryPoint.href;

function differentialSource(nested: boolean, mode: 'capture' | 'fixed' | 'replay'): string {
    const invocation = `{
        generator: gen.constant(null).map(() => { throw new Error('unexpected generation'); }),
        examples: ${mode === 'capture' ? '[graph]' : '[]'},
        test: differential({ implementations: [
            { name: 'first', run(input) {
                if (input.left !== input.right || input.self !== input || input.left.value !== 7)
                    throw new Error('corrupted input');
                input.left.value = 8;
                return input.right.value;
            } },
            { name: 'second', async run(input) {
                if (input.left !== input.right || input.self !== input || input.left.value !== 7)
                    throw new Error('corrupted input');
                return input.left.value + ${mode === 'fixed' ? '1' : '0'};
            } }
        ], check(observations, sample) {
            sample.cleanup(() => {
                if (observations[0].input.left.value !== 8) throw new Error('cleanup lost input');
            });
            sample.assert.equal(observations[0].outcome.kind, 'returned');
            sample.assert.equal(observations[1].outcome.kind, 'returned');
            sample.assert.equal(observations[0].input.left.value, 8);
            sample.assert.equal(observations[1].input.left.value, 7);
            sample.assert.deepEqual(observations[0].outcome, observations[1].outcome,
                { message: 'differential mismatch' });
            return sample.assert.collect();
        } })
    }`;
    const declaration = nested
        ? `test('differential contract', withProperties(async parent => {
            return await parent.forall({key: 'comparison', ...${invocation}});
        }))`
        : `property({title: 'differential contract', ...${invocation}})`;
    return `import {differential} from ${JSON.stringify(differentialUrl)};
import {gen, property, withProperties} from ${JSON.stringify(replayPropertyUrl)};
import {test} from ${JSON.stringify(replayAuthoringUrl)};
function graph() {
    const shared = {value: 7};
    const input = {left: shared, right: shared}; input.self = input; return input;
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

export const testNode = suite(
    'runner differential contracts',
    [ table({
        title: 'replays differential inputs',
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
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
            });

            await writeReplayCase(project, differentialSource(nested, 'capture'));
            const captureWitnessCaptured = await orchestrator.run(project.command);
            scope.assert.equal(captureWitnessCaptured.summary.failed, 1);
            scope.assert.deepEqual(captureWitnessCaptured.runnerErrors, []);
            const captureWitnessWitness = captureWitnessCaptured.perTest[0]?.property?.invocations[0]?.confirmedWitness;
            scope.require.defined(captureWitnessWitness);
            const captureWitnessFile = path.join(project.cwd, 'differential.witness.json');
            await writeFile(captureWitnessFile, JSON.stringify(captureWitnessWitness));
            const file = captureWitnessFile;

            await writeReplayCase(project, differentialSource(nested, 'replay'));
            await scope.assert(verifyCorpus, project, file);
            await scope.assert(verifyReplay, project, file, false);
            await writeReplayCase(project, differentialSource(nested, 'fixed'));
            await scope.assert(verifyReplay, project, file, true);
            return scope.assert.collect();
        }
    }) ]
);
