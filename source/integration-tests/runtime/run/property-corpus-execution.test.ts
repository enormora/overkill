import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, type TestScope, suite, test } from '@overkill-dev/test';

import {
    defineReporter,
    parseWitnessFile,
    type PropertyWitnessFile,
    type DefinedReporter
} from '../../../packages/engine/engine.entry-point.ts';
import { normalizeConfig, orchestrator, type RunCommand } from '../../../packages/run/run.entry-point.ts';
import { writeCorpusIndex } from '../../../test-support/corpus-index.ts';
import { defaultRunRequest } from '../../../test-support/run-command-factory.ts';

async function corpusCommand(
    cleanup: TestScope['cleanup'],
    processModel: 'in-process' | 'supervised-process'
): Promise<RunCommand> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'overkill-corpus-run-'));
    cleanup(async function removeState() {
        await rm(directory, { recursive: true, force: true });
    });
    const fixture = 'source/integration-tests/runtime/fixtures/property-regression.test.ts';
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
    cleanup: TestScope['cleanup'],
    processModel: 'in-process' | 'supervised-process'
): Promise<IncompatibleCorpus> {
    const command = await corpusCommand(cleanup, processModel);
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
const assertCheckedInCompatibility = defineCompositeAssertion({
    name: 'checked in compatibility',
    async assert(check, input: IncompatibleCorpus) {
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
        return check.group([
            check.equal(checkedIn.summary.passed, 0),
            check.equal(checkedIn.summary.failed, 1),
            check.equal(await readFile(file, 'utf8'), content)
        ]);
    }
});
const assertLocalCompatibility = defineCompositeAssertion({
    name: 'local compatibility',
    async assert(check, input: IncompatibleCorpus) {
        const { command, incompatible } = input;
        const cache = path.join(
            command.config.runtimeStateDir,
            'corpus',
            createHash('sha256').update('laws').digest('hex')
        );
        await mkdir(cache, { recursive: true });
        await writeCorpusIndex(path.join(cache, 'index.json'), [ incompatible ]);
        const local = await orchestrator.run(command);
        return check.group([
            check.includes(JSON.stringify(local.perTest), 'Skipped incompatible'),
            check.equal(
                local.perTest[0]?.property?.invocations[0]?.summary?.accounting.phases['local-cache'].executed,
                0
            )
        ]);
    }
});
const assertReplayCompatibility = defineCompositeAssertion({
    name: 'replay compatibility',
    async assert(check, input: IncompatibleCorpus) {
        const { command, file } = input;
        const replay = await orchestrator.replayWitness({
            ...command,
            request: {
                debug: { mode: 'off', selectors: [] },
                path: file,
                profile: 'laws',
                seed: { value: 42n },
                capture: 'buffered',
                record: false,
                timingCollection: 'profile-default'
            }
        }, { signal: null, timing: null });
        return check.group([ check.true(replay.runnerErrors.some(function compatibilityError(error) {
            return error.subtype === 'witness-replay';
        })) ]);
    }
});

function blockCorpusAfterCase(file: string): DefinedReporter {
    return defineReporter(function () {
        return {
            kind: 'real-time',
            name: 'corpus-write-failure',
            sinks: [],
            dispose: null,
            onFinish: null,
            async onEvent(event) {
                if (event.kind === 'test-end') {
                    await writeFile(file, 'not a directory');
                }
            }
        };
    });
}
export const testNode = suite(
    'runner property corpus',
    [
        table({
            title: 'saves and replays confirmed failures',
            cases: [ 'in-process', 'supervised-process' ] as const,
            caseTitle(processModel) {
                return processModel;
            },
            async test(scope) {
                const command = await corpusCommand(scope.cleanup, scope.parameters);
                const first = await orchestrator.run(command);
                const replay = await orchestrator.run(command);
                scope.assert.deepEqual(first.runnerErrors, []);
                scope.assert.deepEqual(replay.runnerErrors, []);
                scope.assert.equal(first.summary.failed, 1);
                scope.assert.equal(replay.summary.failed, 1);
                scope.assert.equal(shrinkStatus(first), 'search-exhausted');
                scope.assert.equal(shrinkStatus(replay), 'shrink-state-unavailable');
                return scope.assert.collect();
            }
        }),
        table({
            title: 'directly replays a witness through normal execution',
            cases: [ 'in-process', 'supervised-process' ] as const,
            caseTitle(processModel) {
                return processModel;
            },
            async test(scope) {
                const processModel = scope.parameters;

                const command = await corpusCommand(scope.cleanup, processModel);
                const file = await saveReplayWitness(command);
                const replay = await orchestrator.replayWitness({
                    ...command,
                    request: {
                        debug: { mode: 'off', selectors: [] },
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
            }
        }),
        table({
            title: 'rejects a witness whose case is missing',
            cases: [ 'in-process', 'supervised-process' ] as const,
            caseTitle(processModel) {
                return processModel;
            },
            async test(scope) {
                const processModel = scope.parameters;

                const command = await corpusCommand(scope.cleanup, processModel);
                const file = await saveReplayWitness(command);
                const saved = parseWitnessFile(JSON.parse(await readFile(file, 'utf8')));
                await writeFile(file, JSON.stringify({ ...saved, case: { ...saved.case, title: 'missing property' } }));
                const replay = await orchestrator.replayWitness({
                    ...command,
                    request: {
                        debug: { mode: 'off', selectors: [] },
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
            }
        }),
        table({
            title: 'enforces corpus compatibility policies',
            cases: [ 'in-process', 'supervised-process' ] as const,
            caseTitle(processModel) {
                return processModel;
            },
            async test(scope) {
                const processModel = scope.parameters;

                const input = await incompatibleCorpus(scope.cleanup, processModel);
                await scope.assert(assertCheckedInCompatibility, input);
                await scope.assert(assertLocalCompatibility, input);
                await scope.assert(assertReplayCompatibility, input);
                return scope.assert.collect();
            }
        }),
        test('retains confirmed failures when local persistence fails', async function (scope) {
            const command = await corpusCommand(scope.cleanup, 'in-process');
            const blocked = path.join(command.config.runtimeStateDir, 'corpus');
            const result = await orchestrator.run({
                ...command,
                config: { ...command.config, reporters: [ blockCorpusAfterCase(blocked) ] }
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
