import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RunResult } from '../../packages/engine/engine.entry-point.ts';
import { suite, test, runIfMain, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    type ReplayProject,
    replayProject,
    writeReplayCase,
    executeReplayCli,
    replayAuthoringUrl,
    replayPropertyUrl
} from '../../test-support/replay-project-fixture.ts';

const modelEntryPoint = new URL('../../packages/model/model.entry-point.ts', import.meta.url);
const modelUrl = modelEntryPoint.href;

function modelSource(nested: boolean, mode: 'capture' | 'invalid' | 'replay'): string {
    const invocation = `{
        initial: () => 0,
        commands() { throw new Error('unexpected generation'); },
        transition(state, operation) {
            return ${mode === 'invalid' ? 'operation === 3' : 'false'}
                ? {kind: 'disabled'} : {kind: 'enabled', state: state + operation};
        },
        length: {minLength: 0, maxLength: 0}, codec: null,
        examples: ${mode === 'capture' ? '[() => [1, 2, 3]]' : '[]'}, coverage: [],
        create(sample) {
            const operations = [];
            sample.cleanup(() => {
                if (JSON.stringify(operations) !== '[1,2,3]') throw new Error('incorrect executed trace');
            });
            return operations;
        },
        run(operation, system) { system.push(operation); },
        check(state, system, sample) {
            sample.assert.equal(system.reduce((sum, value) => sum + value, 0), state);
            if (system.length === 3) sample.assert.fail({message: 'retained model mismatch'});
        }
    }`;
    const declaration = nested
        ? `test('model contract', withProperties(async parent => {
            return await parent.forall({key: 'model', ...modelScenario(${invocation})});
        }))`
        : `model({title: 'model contract', settings: {}, ...${invocation}})`;
    return [
        `import {model, modelScenario} from ${JSON.stringify(modelUrl)};`,
        `import {withProperties} from ${JSON.stringify(replayPropertyUrl)};`,
        `import {test} from ${JSON.stringify(replayAuthoringUrl)};`,
        `export const testNode = ${declaration};`
    ]
        .join('\n');
}

function assertModelMismatch(scope: TestScope, result: RunResult): void {
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.includes(JSON.stringify(result.perTest), 'retained model mismatch');
    scope.assert.equal(JSON.stringify(result).includes('incorrect executed trace'), false);
    scope.assert.equal(JSON.stringify(result).includes('unexpected generation'), false);
}

async function captureModelWitness(scope: TestScope, project: ReplayProject, nested: boolean): Promise<string> {
    await writeReplayCase(project, modelSource(nested, 'capture'));
    const captured = await orchestrator.run(project.command);
    const witness = captured
        .perTest[0]
        ?.property
        ?.invocations
        .find(function (invocation) {
            return invocation.confirmedWitness !== null;
        })
        ?.confirmedWitness;
    scope.require.defined(witness);
    const file = path.join(project.cwd, 'model.witness.json');
    await writeFile(file, JSON.stringify(witness));

    return file;
}

async function verifyCorpus(scope: TestScope, project: ReplayProject, file: string): Promise<void> {
    const profile = project.command.config.profiles.cases;
    scope.require.defined(profile);
    if (profile.testFamily !== 'property') {
        throw new TypeError('Expected property profile.');
    }
    const regression = await orchestrator.run({
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
    assertModelMismatch(scope, regression);
    const target = regression.perTest[0]?.property?.invocations.find(function (invocation) {
        return (invocation.summary?.accounting.phases['checked-in-corpus'].executed ?? 0) > 0;
    });
    scope.require.defined(target);
    scope.assert.equal(target.summary?.accounting.phases.exploration.executed, 0);
}

async function verifyReplay(scope: TestScope, project: ReplayProject, file: string): Promise<void> {
    const result = await orchestrator.replayWitness({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
    assertModelMismatch(scope, result);
    const cli = await executeReplayCli(project, [ 'replay-witness', file, '--profile', 'cases' ]);
    scope.assert.equal(cli.code, 1);
    scope.assert.includes(cli.output, 'retained model mismatch');
}

async function verifyInvalidTrace(
    scope: TestScope,
    project: ReplayProject,
    file: string,
    nested: boolean
): Promise<void> {
    await writeReplayCase(project, modelSource(nested, 'invalid'));
    const invalid = await orchestrator.replayWitness({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
    scope.assert.includes(JSON.stringify(invalid.perTest), 'Model trace contains a disabled operation at index 2.');
    scope.assert.equal(JSON.stringify(invalid).includes('incorrect executed trace'), false);
}

export const testNode = suite(
    'runner model contracts',
    ([ 'in-process', 'supervised-process' ] as const).flatMap(function executionMode(processModel) {
        return [ false, true ].map(function composition(nested) {
            return test(
                `${processModel} replays ${nested ? 'nested' : 'direct'} model traces`,
                async function (scope: TestScope) {
                    const project = await replayProject(scope, {
                        testFamily: 'property',
                        files: { include: [ 'case.test.ts' ] },
                        execution: { processModel, scheduling: 'serial' },
                        property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0, maxSize: 0 },
                        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    });
                    const file = await captureModelWitness(scope, project, nested);
                    await writeReplayCase(project, modelSource(nested, 'replay'));
                    await verifyReplay(scope, project, file);
                    await verifyCorpus(scope, project, file);
                    await verifyInvalidTrace(scope, project, file, nested);
                    return scope.assert.collect();
                }
            );
        });
    })
);
await runIfMain(import.meta, testNode);
