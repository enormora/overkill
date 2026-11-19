import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type TestScope, test as authoredTest, suite as authoredSuite } from '@overkill-dev/test';
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

async function captureWitness(scope: TestScope, project: ReplayProject, nested: boolean): Promise<string> {
    await writeReplayCase(project, differentialSource(nested, 'capture'));
    const captured = await orchestrator.run(project.command);
    scope.assert.equal(captured.summary.failed, 1);
    scope.assert.deepEqual(captured.runnerErrors, []);
    const witness = captured.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    scope.require.defined(witness);
    const file = path.join(project.cwd, 'differential.witness.json');
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

export const testNode = authoredSuite(
    'runner differential contracts',
    ([ 'in-process', 'supervised-process' ] as const).flatMap(function executionMode(processModel) {
        return [ false, true ].map(function composition(nested) {
            return authoredTest(
                `${processModel} replays ${nested ? 'nested' : 'direct'} differential inputs`,
                async function (scope: TestScope) {
                    const project = await replayProject(scope, {
                        testFamily: 'property',
                        files: { include: [ 'case.test.ts' ] },
                        execution: { processModel, scheduling: 'serial' },
                        property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0 },
                        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    });
                    const file = await captureWitness(scope, project, nested);
                    await writeReplayCase(project, differentialSource(nested, 'replay'));
                    await verifyCorpus(scope, project, file);
                    await verifyReplay(scope, project, file, false);
                    await writeReplayCase(project, differentialSource(nested, 'fixed'));
                    await verifyReplay(scope, project, file, true);
                    return scope.assert.collect();
                }
            );
        });
    })
);
