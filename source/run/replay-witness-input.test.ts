import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { propertyCorpusEntry } from '../test-support/property-corpus.ts';
import { replayProject, type ReplayProject } from '../test-support/replay-project-fixture.ts';
import { normalizeConfig, type ReplayWitnessCommand } from '../packages/run/run.entry-point.ts';
import type { PreparedReplay } from './replay-types.ts';
import { prepareWitnessReplay, preparePropertyReplay } from './witness-replay-preparation.ts';

async function witnessProject(scope: TestScope): Promise<ReplayProject> {
    const project = await replayProject(scope, {
        testFamily: 'property',
        files: { include: [ 'laws.ts' ] },
        execution: { processModel: 'in-process', scheduling: 'serial' }
    });
    return project;
}
async function prepareInput(project: ReplayProject, file: string): Promise<PreparedReplay> {
    return await prepareWitnessReplay({
        debug: { mode: 'off', selectors: [] },
        cwd: project.cwd,
        config: project.command.config,
        signal: null,
        path: file,
        profile: 'cases'
    });
}
async function writeWitness(project: ReplayProject, file: string, witness: unknown): Promise<void> {
    const absolute = path.join(project.cwd, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, JSON.stringify(witness));
}
function profileCommand(config: ReplayWitnessCommand['config'], profile: string | null): ReplayWitnessCommand {
    return {
        cwd: process.cwd(),
        config,
        engine: { kind: 'default' },
        request: {
            debug: { mode: 'off', selectors: [] },
            path: 'missing.witness.json',
            profile,
            seed: { value: null },
            capture: 'buffered',
            record: false,
            timingCollection: 'profile-default'
        }
    };
}
export const testNode = suite('witness input preparation', [
    ...[ null, '/absolute.ts', '../outside.ts' ].map(function invalidSource(file) {
        return test(`rejects source ${String(file)}`, async function (scope: TestScope) {
            const project = await witnessProject(scope);
            await writeWitness(project, 'input.json', {
                ...propertyCorpusEntry,
                case: { ...propertyCorpusEntry.case, file }
            });
            await scope.assert.rejects(async function rejectSource() {
                await prepareInput(project, 'input.json');
            }, { message: /project-relative source/u });
            return scope.assert.collect();
        });
    }),
    test('rejects an unavailable source module', async function (scope: TestScope) {
        const project = await witnessProject(scope);
        await writeWitness(project, 'input.json', propertyCorpusEntry);
        await scope.assert.rejects(async function missingSource() {
            await prepareInput(project, 'input.json');
        }, { message: /source is unavailable/u });
        return scope.assert.collect();
    }),
    ...[ true, false ].map(function escapingLink(parentDirectory) {
        return test(
            parentDirectory
                ? 'rejects a source link to the parent directory'
                : 'rejects a source link outside the project',
            async function (scope: TestScope) {
                const project = await witnessProject(scope);
                const external = await witnessProject(scope);
                await writeFile(path.join(external.cwd, 'outside.ts'), 'throw new Error("must not import");');
                await symlink(
                    parentDirectory ? path.dirname(project.cwd) : path.join(external.cwd, 'outside.ts'),
                    path.join(project.cwd, 'laws.ts')
                );
                await writeWitness(project, 'input.json', propertyCorpusEntry);
                await scope.assert.rejects(async function rejectEscape() {
                    await prepareInput(project, 'input.json');
                }, { message: /escapes the replay project/u });
                return scope.assert.collect();
            }
        );
    }),
    test('rejects a missing witness file', async function (scope: TestScope) {
        const project = await witnessProject(scope);
        await scope.assert.rejects(async function missingWitness() {
            await prepareInput(project, 'missing.json');
        }, { message: /Cannot read replay input/u });
        return scope.assert.collect();
    }),
    test('rejects malformed witness JSON', async function (scope: TestScope) {
        const project = await witnessProject(scope);
        await writeFile(path.join(project.cwd, 'input.json'), '{');
        await scope.assert.rejects(async function malformedWitness() {
            await prepareInput(project, 'input.json');
        }, { message: /Cannot read replay input/u });
        return scope.assert.collect();
    }),
    test('rejects an unsupported witness version', async function (scope: TestScope) {
        const project = await witnessProject(scope);
        await writeWitness(project, 'input.json', { ...propertyCorpusEntry, version: 99 });
        await scope.assert.rejects(async function unsupportedWitness() {
            await prepareInput(project, 'input.json');
        }, { message: /incompatible/u });
        return scope.assert.collect();
    }),
    ...[
        { file: '.overkill/runs/retained-run/witnesses/input.json', source: 'retained-run' },
        { file: '.overkill/runs/standalone', source: null },
        { file: 'input.json', source: null }
    ]
        .map(function sourceRetention(entry) {
            return test(`retains source identity for ${entry.file}`, async function (scope: TestScope) {
                const project = await witnessProject(scope);
                await writeFile(path.join(project.cwd, 'laws.ts'), 'throw new Error("must not import");');
                await writeWitness(project, entry.file, propertyCorpusEntry);
                const prepared = await prepareInput(project, entry.file);
                const witness = prepared.replay.kind === 'witness' ? prepared.replay : undefined;
                scope.require.defined(witness);
                scope.assert.equal(witness.sourceRunId, entry.source);
                scope.assert.deepEqual(prepared.command.request.paths, [ 'laws.ts' ]);
                scope.assert.equal(prepared.command.request.seed.value, 42n);
                return scope.assert.collect();
            });
        }),
    ...[
        { title: 'rejects profile inference without a property profile', config: normalizeConfig({}), profile: null },
        {
            title: 'rejects ambiguous property profiles',
            config: normalizeConfig({
                profiles: {
                    first: { testFamily: 'property', files: { include: [ 'laws.ts' ] } },
                    second: { testFamily: 'property', files: { include: [ 'laws.ts' ] } }
                }
            }),
            profile: null
        },
        { title: 'rejects an unknown explicit replay profile', config: normalizeConfig({}), profile: 'missing' }
    ]
        .map(function profileSelection(entry) {
            return test(entry.title, async function (scope: TestScope) {
                await scope.assert.rejects(async function rejectProfile() {
                    await preparePropertyReplay(profileCommand(entry.config, entry.profile));
                }, { message: /configured replay profile/u });
                return scope.assert.collect();
            });
        })
]);
await runIfMain(import.meta, testNode);
