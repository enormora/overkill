import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';

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

const modelMismatchChecks = function (
    check: CompositeCheckBuilder<'assert'>,
    result: RunResult
): CompositeAssertionReturn<'assert'> {
    return check.group([
        check.equal(result.summary.failed, 1),
        check.deepEqual(result.runnerErrors, []),
        check.includes(JSON.stringify(result.perTest), 'retained model mismatch'),
        check.equal(JSON.stringify(result).includes('incorrect executed trace'), false),
        check.equal(JSON.stringify(result).includes('unexpected generation'), false)
    ]);
};

async function captureModelWitness(project: ReplayProject, nested: boolean): Promise<string> {
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
    if (witness === undefined || witness === null) {
        throw new Error('Expected witness to satisfy defined.');
    }
    const file = path.join(project.cwd, 'model.witness.json');
    await writeFile(file, JSON.stringify(witness));

    return file;
}

const verifyCorpus = defineCompositeAssertion({
    name: 'verify corpus',
    async assert(check, project: ReplayProject, file: string) {
        const profile = project.command.config.profiles.cases;
        if (profile === undefined) {
            return check.defined(profile);
        }

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
        const intermediateChecks = modelMismatchChecks(check.annotated('model mismatch'), regression);
        const target = regression.perTest[0]?.property?.invocations.find(function (invocation) {
            return (invocation.summary?.accounting.phases['checked-in-corpus'].executed ?? 0) > 0;
        });
        return check.group([
            intermediateChecks,
            check.partialDeepEqual(target ?? {}, {
                summary: { accounting: { phases: { exploration: { executed: 0 } } } }
            })
        ]);
    }
});

const verifyReplay = defineCompositeAssertion({
    name: 'verify replay',
    async assert(check, project: ReplayProject, file: string) {
        const result = await orchestrator.replayWitness({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            path: file,
            profile: 'cases'
        });
        const initialChecks = modelMismatchChecks(check.annotated('model mismatch'), result);
        const cli = await executeReplayCli(project, [ 'replay-witness', file, '--profile', 'cases' ]);
        return check.group([
            initialChecks,
            check.equal(cli.code, 1),
            check.includes(cli.output, 'retained model mismatch')
        ]);
    }
});

const verifyInvalidTrace = defineCompositeAssertion({
    name: 'verify invalid trace',
    async assert(check, project: ReplayProject, file: string, nested: boolean) {
        await writeReplayCase(project, modelSource(nested, 'invalid'));
        const invalid = await orchestrator.replayWitness({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            path: file,
            profile: 'cases'
        });
        return check.group([
            check.includes(JSON.stringify(invalid.perTest), 'Model trace contains a disabled operation at index 2.'),
            check.equal(JSON.stringify(invalid).includes('incorrect executed trace'), false)
        ]);
    }
});

export const testNode = suite(
    'runner model contracts',
    [ table({
        title: 'replays model traces',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function executionMode(processModel) {
            return [ false, true ].map(function composition(nested) {
                return { processModel, nested };
            });
        }),
        caseTitle({ processModel, nested }) {
            return [ processModel, nested ? 'nested' : 'direct' ].map(String).join(', ');
        },
        async test(scope) {
            const { processModel, nested } = scope.parameters;

            const project = await replayProject(scope.cleanup, {
                testFamily: 'property',
                files: { include: [ 'case.test.ts' ] },
                execution: { processModel, scheduling: 'serial' },
                property: { newTrials: 1, maxAutomaticEdges: 0, maxExhaustiveValues: 0, maxSize: 0 },
                timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
            });
            const file = await captureModelWitness(project, nested);
            await writeReplayCase(project, modelSource(nested, 'replay'));
            await scope.assert(verifyReplay, project, file);
            await scope.assert(verifyCorpus, project, file);
            await scope.assert(verifyInvalidTrace, project, file, nested);
            return scope.assert.collect();
        }
    }) ]
);
