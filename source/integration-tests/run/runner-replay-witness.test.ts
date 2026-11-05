import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
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
    const nestedDeclaration = [
        "test('retained property', withProperties(async parent => await parent.forall({key: 'retained', ",
        invocation,
        '})))'
    ]
        .join('');
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
async function savedPropertyWitness(scope: TestScope, project: ReplayProject): Promise<string> {
    const result = await orchestrator.run(project.command);
    const witness = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    scope.require.defined(witness);
    const file = 'retained.witness.json';
    await writeFile(path.join(project.cwd, file), JSON.stringify(witness));
    return file;
}
type RetainedPropertyProject = { readonly project: ReplayProject; readonly file: string; };
async function retainedPropertyProject(
    scope: TestScope,
    nested: boolean,
    mode: 'in-process' | 'supervised-process'
): Promise<RetainedPropertyProject> {
    const project = await replayProject(scope, {
        testFamily: 'property',
        files: { include: [ 'case.test.ts' ] },
        execution: { processModel: mode, scheduling: 'serial' },
        timeouts: { collectionMilliseconds: 30_000, softMilliseconds: 5000, hardMilliseconds: 10_000 },
        property: { newTrials: 1 }
    });
    await writeReplayCase(project, propertySource(nested, true));
    const file = await savedPropertyWitness(scope, project);
    await writeReplayCase(project, propertySource(nested, false));
    return { project, file };
}
async function verifyPropertyWitness(
    scope: TestScope,
    nested: boolean,
    mode: 'in-process' | 'supervised-process'
): Promise<void> {
    const { project, file } = await retainedPropertyProject(scope, nested, mode);
    const result = await orchestrator.replayWitness({
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.deepEqual(result.runnerErrors, []);
    scope.assert.false(JSON.stringify(result).includes('generated during replay'));
    const cli = await executeReplayCli(project, [ 'replay-witness', file, '--profile', 'cases' ]);
    scope.assert.equal(cli.code, 1);
}
async function verifyRecordedWitness(scope: TestScope): Promise<void> {
    const { project, file } = await retainedPropertyProject(scope, false, 'in-process');
    await orchestrator.replayWitness({
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
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        runId: recorded.id
    });
    scope.assert.equal(result.summary.failed, 1);
    scope.assert.false(JSON.stringify(result).includes('generated during replay'));
}
export const testNode = suite('witness replay through public surfaces', [
    test('recorded witness replays retain the concrete input', async function (scope: TestScope) {
        await verifyRecordedWitness(scope);
        return scope.assert.collect();
    }),
    ...([ 'in-process', 'supervised-process' ] as const).flatMap(function boundary(mode) {
        return [ false, true ].map(function target(nested) {
            return test(
                `${mode} replays ${nested ? 'nested' : 'direct'} property input without generating`,
                async function (scope: TestScope) {
                    await verifyPropertyWitness(scope, nested, mode);
                    return scope.assert.collect();
                }
            );
        });
    })
]);
await runIfMain(import.meta, testNode);
