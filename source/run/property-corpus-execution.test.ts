import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIfMain } from '#test-runner';
import { parseWitnessFile, type PropertyWitnessFile } from '../packages/engine/engine.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../packages/run/run.entry-point.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';

async function corpusCommand(scope: TestScope, processModel: 'in-process' | 'supervised-process'): Promise<RunCommand> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-corpus-run-'));
    scope.cleanup(async function removeState() {
        await rm(directory, { recursive: true, force: true });
    });
    const fixture = 'source/integration-tests/run/fixtures/property-regression.test.ts';
    return {
        config: {
            ...normalizeConfig({
                runtimeStateDir: directory,
                profiles: {
                    laws: {
                        testFamily: 'property',
                        files: { include: [ fixture ] },
                        execution: { processModel, scheduling: 'serial' },
                        timeouts: { collectionMilliseconds: 10_000, softMilliseconds: 5000, hardMilliseconds: 10_000 }
                    }
                }
            }),
            reporters: []
        },
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: defaultRunRequest({ profile: 'laws', paths: [ fixture ], order: 'plan' })
    };
}

function shrinkStatus(result: Awaited<ReturnType<typeof orchestrator.run>>): string | null {
    return result.perTest[0]?.property?.invocations[0]?.shrinkStatus ?? null;
}

async function saveReplayWitness(command: RunCommand): Promise<string> {
    const first = await orchestrator.run(command);
    const witness = first.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (witness === null || witness === undefined) {
        throw new Error('Expected a confirmed witness.');
    }
    const file = path.join(command.config.runtimeStateDir, 'replay.witness.json');
    await writeFile(file, JSON.stringify(witness));
    return file;
}

type IncompatibleCorpus = {
    readonly command: RunCommand;
    readonly file: string;
    readonly content: string;
    readonly incompatible: PropertyWitnessFile;
};
async function incompatibleCorpus(
    scope: TestScope,
    processModel: 'in-process' | 'supervised-process'
): Promise<IncompatibleCorpus> {
    const command = await corpusCommand(scope, processModel);
    const file = await saveReplayWitness(command);
    const saved = parseWitnessFile(JSON.parse(await readFile(file, 'utf8')));
    if (saved.kind !== 'property') {
        throw new TypeError('Expected property witness.');
    }
    const incompatible = {
        ...saved,
        counterexample: {
            ...saved.counterexample,
            format: {
                ...saved
                    .counterexample
                    .format,
                version: 999
            }
        }
    };
    const content = JSON.stringify(incompatible);
    await writeFile(file, content);
    return { command, file, content, incompatible };
}
async function assertCheckedInCompatibility(scope: TestScope, input: IncompatibleCorpus): Promise<void> {
    const { command, file, content } = input;
    const profile = command.config.profiles.laws;
    if (profile?.testFamily !== 'property') {
        throw new TypeError('Expected property profile.');
    }
    const checkedIn = await orchestrator.run({
        ...command,
        config: {
            ...command.config,
            profiles: {
                laws: {
                    ...profile,
                    corpus: { ...profile.corpus, checkedIn: [ file ] }
                }
            }
        }
    });
    scope.assert.equal(checkedIn.summary.passed, 0);
    scope.assert.equal(checkedIn.summary.failed, 1);
    scope.assert.equal(await readFile(file, 'utf8'), content);
}
async function assertLocalCompatibility(scope: TestScope, input: IncompatibleCorpus): Promise<void> {
    const { command, incompatible } = input;
    const cache = path.join(
        command.config.runtimeStateDir,
        'corpus',
        createHash('sha256').update('laws').digest('hex')
    );
    await mkdir(cache, { recursive: true });
    await writeFile(
        path.join(cache, 'index.json'),
        JSON.stringify({
            version: 1,
            entries: [
                { id: 'incompatible', savedAt: '2026-11-06T00:00:00.000Z', entry: incompatible }
            ]
        })
    );
    const local = await orchestrator.run(command);
    scope.assert.includes(JSON.stringify(local.perTest), 'Skipped incompatible');
    scope.assert.equal(
        local.perTest[0]?.property?.invocations[0]?.summary?.accounting.phases['local-cache'].executed,
        0
    );
}
async function assertReplayCompatibility(scope: TestScope, input: IncompatibleCorpus): Promise<void> {
    const { command, file } = input;
    const replay = await orchestrator.replayWitness({
        ...command,
        request: {
            path: file,
            profile: 'laws',
            seed: { value: 42n },
            capture: 'buffered',
            record: false,
            timingCollection: 'profile-default'
        }
    }, { signal: null, timing: null });
    scope.assert.true(replay.runnerErrors.some(function compatibilityError(error) {
        return error.subtype === 'witness-replay';
    }));
}

export const testNode = suite(
    'runner property corpus',
    [
        ...([ 'in-process', 'supervised-process' ] as const).map(function processExecution(processModel) {
            return test(`${processModel} saves and replays confirmed failures`, async function (scope) {
                const command = await corpusCommand(scope, processModel);
                const first = await orchestrator.run(command);
                const replay = await orchestrator.run(command);
                scope.assert.deepEqual(first.runnerErrors, []);
                scope.assert.deepEqual(replay.runnerErrors, []);
                scope.assert.equal(first.summary.failed, 1);
                scope.assert.equal(replay.summary.failed, 1);
                scope.assert.equal(shrinkStatus(first), 'search-exhausted');
                scope.assert.equal(shrinkStatus(replay), 'shrink-state-unavailable');
                return scope.assert.collect();
            });
        }),
        ...([ 'in-process', 'supervised-process' ] as const).map(function directReplay(processModel) {
            return test(`${processModel} directly replays a witness through normal execution`, async function (scope) {
                const command = await corpusCommand(scope, processModel);
                const file = await saveReplayWitness(command);
                const replay = await orchestrator.replayWitness({
                    ...command,
                    request: {
                        path: file,
                        profile: 'laws',
                        seed: { value: 42n },
                        capture: 'buffered',
                        record: true,
                        timingCollection: 'profile-default'
                    }
                }, { signal: null, timing: null });
                scope.assert.deepEqual(replay.runnerErrors, []);
                scope.assert.equal(replay.summary.failed, 1);
                scope.assert.equal(replay.perTest.length, 1);
                scope.assert.equal(replay.perTest[0]?.property?.invocations[0]?.confirmedWitness, null);
                scope.assert.equal(shrinkStatus(replay), null);
                return scope.assert.collect();
            });
        }),
        ...([ 'in-process', 'supervised-process' ] as const).map(function missingReplay(processModel) {
            return test(`${processModel} rejects a witness whose case is missing`, async function (scope) {
                const command = await corpusCommand(scope, processModel);
                const file = await saveReplayWitness(command);
                const saved = parseWitnessFile(JSON.parse(await readFile(file, 'utf8')));
                await writeFile(file, JSON.stringify({ ...saved, case: { ...saved.case, title: 'missing property' } }));
                const replay = await orchestrator.replayWitness({
                    ...command,
                    request: {
                        path: file,
                        profile: 'laws',
                        seed: { value: 42n },
                        capture: 'buffered',
                        record: false,
                        timingCollection: 'profile-default'
                    }
                }, { signal: null, timing: null });
                scope.assert.true(replay.runnerErrors.some(function replayError(error) {
                    return error.subtype === 'witness-replay';
                }));
                scope.assert.equal(replay.summary.passed, 0);
                return scope.assert.collect();
            });
        }),
        ...([ 'in-process', 'supervised-process' ] as const).map(function incompatibleInput(processModel) {
            return test(`${processModel} enforces corpus compatibility policies`, async function (scope: TestScope) {
                const input = await incompatibleCorpus(scope, processModel);
                await assertCheckedInCompatibility(scope, input);
                await assertLocalCompatibility(scope, input);
                await assertReplayCompatibility(scope, input);
                return scope.assert.collect();
            });
        }),
        test('retains confirmed failures when local persistence fails', async function (scope) {
            const command = await corpusCommand(scope, 'in-process');
            const blocked = path.join(command.config.runtimeStateDir, 'blocked');
            await writeFile(blocked, 'not a directory');
            const result = await orchestrator.run({
                ...command,
                config: { ...command.config, runtimeStateDir: blocked }
            });
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.true(result.runnerErrors.some(function corpusWriteFailure(error) {
                return error.subtype === 'runtime-state' && error.message === 'Failed to write property corpus.';
            }));
            scope.assert.true(Boolean(result.perTest[0]?.property?.invocations[0]?.confirmedWitness));
            return scope.assert.collect();
        })
    ]
);
await runIfMain(import.meta, testNode);
