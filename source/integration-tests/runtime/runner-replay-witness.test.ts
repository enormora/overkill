import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { orchestrator } from '../../packages/run/run.entry-point.ts';
import {
    replayRecords,
    replayProject,
    writeReplayCase,
    executeReplayCli,
    replayAuthoringUrl,
    replayPropertyUrl,
    type ReplayProject
} from '../../test-support/replay-project-fixture.ts';

function propertySource(nested: boolean, generating: boolean): string {
    const generator = generating
        ? 'gen.constant(42)'
        : "gen.constant(0).map(() => { throw new Error('generated during replay'); })";
    const invocation = `generator: ${generator}, test(value, sample) {
        sample.assert.equal(value, 0); return sample.assert.collect();
    }`;
    const nestedDeclaration = `test('retained property', withProperties(async parent => {
        const events = ['setup'];
        parent.cleanup(() => {
            if (events.at(-1) !== 'after') throw new Error('Enclosing cleanup lost continuation');
        });
        await parent.forall({ key: 'before', generator: gen.constant(7), test(value, sample) {
            events.push('before'); sample.assert.equal(value, 7); return sample.assert.collect();
        }});
        await parent.forall({key: 'retained', ${invocation}});
        events.push('after');
        parent.assert.includes(events, 'before');
        return parent.assert.collect();
    }))`;
    const declaration = nested
        ? nestedDeclaration
        : `property({title: 'retained property', ${invocation}})`;
    return [
        `import {test} from ${JSON.stringify(replayAuthoringUrl)};`,
        `import {property, withProperties, gen} from ${JSON.stringify(replayPropertyUrl)};`,
        `export const testNode = ${declaration};`
    ]
        .join('\n');
}
async function savedPropertyWitness(project: ReplayProject): Promise<string> {
    const result = await orchestrator.run(project.command);
    const witness = result
        .perTest[0]
        ?.property
        ?.invocations
        .find(function confirmed(invocation) {
            return invocation.confirmedWitness !== null;
        })
        ?.confirmedWitness;
    if (witness === undefined || witness === null) {
        throw new Error('Expected witness to satisfy defined.');
    }
    const file = 'retained.witness.json';
    await writeFile(path.join(project.cwd, file), JSON.stringify(witness));
    return file;
}
type RetainedPropertyProject = { readonly project: ReplayProject; readonly file: string; };
async function retainedPropertyProject(
    cleanup: TestScope['cleanup'],
    nested: boolean,
    mode: 'in-process' | 'supervised-process'
): Promise<RetainedPropertyProject> {
    const project = await replayProject(cleanup, {
        testFamily: 'property',
        files: { include: [ 'case.test.ts' ] },
        execution: { processModel: mode, scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 },
        property: { newTrials: 1 }
    });
    await writeReplayCase(project, propertySource(nested, true));
    const file = await savedPropertyWitness(project);
    await writeReplayCase(project, propertySource(nested, false));
    return { project, file };
}

export const testNode = suite('witness replay through public surfaces', [
    table({
        title: 'rejects nested witness targets',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function invalidTargets(mode) {
            return ([ 'missing', 'duplicate', 'unreached' ] as const).map(function targetFailure(kind) {
                return { mode, kind };
            });
        }),
        caseTitle({ mode, kind }) {
            return [ mode, kind ].map(String).join(', ');
        },
        async test(scope) {
            const { mode, kind } = scope.parameters;

            const { project, file } = await retainedPropertyProject(scope.cleanup, true, mode);
            const invocation = `await parent.forall({key: 'retained', generator: gen.constant(0),
                    test(value, sample) { sample.assert.equal(value, 0); return sample.assert.collect(); }});`;
            const bodies = {
                unreached: 'parent.assert.true(true);',
                duplicate: invocation + invocation,
                missing: invocation.replace("'retained'", "'missing'")
            };
            const body = bodies[kind];
            await writeReplayCase(
                project,
                `
import {test} from ${JSON.stringify(replayAuthoringUrl)};
import {withProperties, gen} from ${JSON.stringify(replayPropertyUrl)};
export const testNode = test('retained property', withProperties(async parent => {
    ${body}
    return parent.assert.collect();
}));`
            );
            const result = await orchestrator.replayWitness({
                debug: { mode: 'off', selectors: [] },
                cwd: project.cwd,
                config: project.command.config,
                signal: null,
                path: file,
                profile: 'cases'
            });
            scope.assert.true(result.runnerErrors.some(function replayError(error) {
                return error.subtype === 'witness-replay';
            }));
            scope.assert.equal(result.summary.passed, 0);
            return scope.assert.collect();
        }
    }),
    test('recorded witness replays retain the concrete input', async function (scope: TestScope) {
        const { project, file } = await retainedPropertyProject(scope.cleanup, false, 'in-process');
        await orchestrator.replayWitness({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            path: file,
            profile: 'cases'
        });
        const records = await replayRecords(project);
        const recorded = records.find(function witness(record) {
            return record.replayWitness !== null;
        });
        scope.require.defined(recorded);
        const result = await orchestrator.replay({
            debug: { mode: 'off', selectors: [] },
            cwd: project.cwd,
            config: project.command.config,
            signal: null,
            runId: recorded.id
        });
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.false(JSON.stringify(result).includes('generated during replay'));

        return scope.assert.collect();
    }),
    table({
        title: 'replays property input without generating',
        cases: ([ 'in-process', 'supervised-process' ] as const).flatMap(function boundary(mode) {
            return [ false, true ].map(function target(nested) {
                return { mode, nested };
            });
        }),
        caseTitle({ mode, nested }) {
            return [ mode, nested ? 'nested' : 'direct' ].map(String).join(', ');
        },
        async test(scope) {
            const { mode, nested } = scope.parameters;
            const { project, file } = await retainedPropertyProject(scope.cleanup, nested, mode);
            const verifyPropertyWitnessResult = await orchestrator.replayWitness({
                debug: { mode: 'off', selectors: [] },
                cwd: project.cwd,
                config: project.command.config,
                signal: null,
                path: file,
                profile: 'cases'
            });
            scope.assert.equal(verifyPropertyWitnessResult.summary.failed, 1);
            scope.assert.deepEqual(verifyPropertyWitnessResult.runnerErrors, []);
            scope.assert.false(JSON.stringify(verifyPropertyWitnessResult).includes('generated during replay'));
            const verifyPropertyWitnessCli = await executeReplayCli(project, [
                'replay-witness',
                file,
                '--profile',
                'cases'
            ]);
            scope.assert.equal(verifyPropertyWitnessCli.code, 1);

            return scope.assert.collect();
        }
    })
]);
