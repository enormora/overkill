import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MutantRunStatus, DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import type { RunExecutionReply } from '../run/run.entry-point.ts';
import {
    createMutationDiagnosticFixture,
    readMutationDiagnosticDocuments,
    createMutationDiagnosticFailure,
    assertMutationDiagnosticDocuments,
    assertMutationDiagnosticCheckpoint,
    createMutationTranscriptFixture
} from '../../test-support/mutation-diagnostic-fixture.ts';
import { withMutationDiagnosticPersistence } from './mutation-diagnostic-persistence.ts';
import { mutationDiagnosticEvidence } from './mutation-diagnostic-evidence.ts';

export const testNode = suite('mutation diagnostic persistence', [
    ...([ 'off', 'failures' ] as const).map(function excludedMode(mode) {
        return test(`${mode} leaves excluded successful invocations unwritten`, async function (scope) {
            const fixture = await createMutationDiagnosticFixture(scope, mode);
            const result = await withMutationDiagnosticPersistence(
                fixture.context,
                { kind: 'dry' },
                fixture.budget,
                async function (diagnostics) {
                    diagnostics.record(fixture.reply);
                    return {
                        status: DryRunStatus.Complete,
                        tests: [ { id: 'case', name: 'case', status: TestStatus.Success, timeSpentMs: 1 } ]
                    };
                }
            );
            scope.assert.equal(result.status, DryRunStatus.Complete);
            scope.assert.deepEqual(await readdir(fixture.directory), []);
            return scope.assert.collect();
        });
    }),
    test('off leaves failed invocations unwritten', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'off');
        await withMutationDiagnosticPersistence(
            fixture.context,
            { kind: 'mutant', mutant: 'm' },
            fixture.budget,
            async function (diagnostics) {
                diagnostics.record(fixture.reply);
                return { status: MutantRunStatus.Killed, killedBy: [], failureMessage: 'failure', nrOfTests: 1 };
            }
        );
        scope.assert.deepEqual(await readdir(fixture.directory), []);
        return scope.assert.collect();
    }),
    test(
        'all preserves bounded captured evidence and unique invocation identity for repeated mutants',
        async function (scope) {
            const fixture = await createMutationDiagnosticFixture(scope, 'all');
            for (const mutant of [ '../mutant', '../mutant' ]) {
                await withMutationDiagnosticPersistence(
                    fixture.context,
                    { kind: 'mutant', mutant },
                    fixture.budget,
                    async function (diagnostics) {
                        diagnostics.record(fixture.reply);
                        return { status: MutantRunStatus.Survived, nrOfTests: 3 };
                    }
                );
            }
            const documents = await readMutationDiagnosticDocuments(fixture.context);
            assertMutationDiagnosticDocuments(scope, fixture.context, documents);
            return scope.assert.collect();
        }
    ),
    test('failures includes a completed dry run with failed tests', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'failures');
        await withMutationDiagnosticPersistence(
            fixture.context,
            { kind: 'dry' },
            fixture.budget,
            async function (diagnostics) {
                diagnostics.record(fixture.reply);
                return {
                    status: DryRunStatus.Complete,
                    tests: [ {
                        id: 'case',
                        name: 'case',
                        status: TestStatus.Failed,
                        timeSpentMs: 1,
                        failureMessage: 'failure'
                    } ]
                };
            }
        );
        const documents = await readMutationDiagnosticDocuments(fixture.context);
        scope.assert.equal(documents.length, 1);
        return scope.assert.collect();
    }),
    test('retains native failures from lifecycle checkpoints after a timeout', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'failures');
        const lifecycle = await createMutationDiagnosticFailure(scope, true);
        const reply: RunExecutionReply = {
            kind: 'timeout',
            data: lifecycle.snapshot(),
            artifacts: fixture.reply.result.artifacts
        };
        const diagnostic = mutationDiagnosticEvidence('/project', reply);
        assertMutationDiagnosticCheckpoint(scope, diagnostic);
        await withMutationDiagnosticPersistence(
            fixture.context,
            { kind: 'mutant', mutant: 'm' },
            fixture.budget,
            async function (diagnostics) {
                diagnostics.record(reply);
                return { status: MutantRunStatus.Timeout, reason: 'deadline' };
            }
        );
        const documents = await readMutationDiagnosticDocuments(fixture.context);
        scope.assert.includes(documents[0] ?? '', 'body-error sentinel');
        return scope.assert.collect();
    }),
    test('write failures preserve earlier confirmed case diagnostics', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'failures');
        await writeFile(fixture.context.directory, 'blocked');
        const lifecycle = await createMutationDiagnosticFailure(scope, false);
        await scope.assert.rejects(async function persistAfterKill() {
            await withMutationDiagnosticPersistence(
                fixture.context,
                { kind: 'mutant', mutant: 'm' },
                fixture.budget,
                async function (diagnostics) {
                    diagnostics.record({ ...fixture.reply, data: lifecycle.snapshot() });
                    return { status: MutantRunStatus.Killed, killedBy: [], failureMessage: 'failure', nrOfTests: 1 };
                }
            );
        }, { message: /Mutation diagnostic persistence failed:[\s\S]*body-error sentinel/u });
        return scope.assert.collect();
    }),
    ...([ { status: DryRunStatus.Error, errorMessage: 'infrastructure sentinel' }, {
        status: MutantRunStatus.Timeout,
        reason: 'timeout sentinel'
    } ] as const)
        .map(function failedCompletion(result) {
            return test(`preserves ${result.status} evidence when persistence also fails`, async function (scope) {
                const fixture = await createMutationDiagnosticFixture(scope, 'failures');
                await writeFile(fixture.context.directory, 'blocked');
                await scope.assert.rejects(async function failedDelivery() {
                    await withMutationDiagnosticPersistence(
                        fixture.context,
                        { kind: 'dry' },
                        fixture.budget,
                        async function () {
                            return result;
                        }
                    );
                }, { message: /Mutation diagnostic persistence failed:[\s\S]*sentinel/u });
                return scope.assert.collect();
            });
        }),
    test('retains execution errors without inventing case attribution', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'failures');
        await scope.assert.rejects(async function failedCollection() {
            await withMutationDiagnosticPersistence(
                fixture.context,
                { kind: 'dry' },
                fixture.budget,
                async function () {
                    throw new Error('collection sentinel');
                }
            );
        }, { message: 'collection sentinel' });
        const documents = await readMutationDiagnosticDocuments(fixture.context);
        scope.assert.includes(documents[0] ?? '', 'collection sentinel');
        return scope.assert.collect();
    }),
    test('copies delivered file-backed transcripts before publishing their durable reference', async function (scope) {
        const fixture = await createMutationTranscriptFixture(scope);

        await withMutationDiagnosticPersistence(
            fixture.context,
            { kind: 'dry' },
            fixture.budget,
            async function (diagnostics) {
                diagnostics.record(fixture.reply);
                return { status: DryRunStatus.Complete, tests: [] };
            }
        );
        await rm(path.join(fixture.directory, 'transcript.bin'));
        const invocations = await readdir(path.join(fixture.context.directory, fixture.context.campaign));
        const directory = path.join(fixture.context.directory, fixture.context.campaign, invocations[0] ?? 'missing');
        scope.assert.equal(await readFile(path.join(directory, 'files', '0.bin'), 'utf8'), 'recorded transcript');
        scope.assert.includes(await readFile(path.join(directory, 'diagnostics.json'), 'utf8'), 'files/0.bin');
        return scope.assert.collect();
    }),
    test('all leaves an invocation without available evidence unwritten', async function (scope) {
        const fixture = await createMutationDiagnosticFixture(scope, 'all');
        await withMutationDiagnosticPersistence(
            fixture.context,
            { kind: 'mutant', mutant: 'm' },
            fixture.budget,
            async function (diagnostics) {
                diagnostics.record(fixture.empty);
                return { status: MutantRunStatus.Survived, nrOfTests: 3 };
            }
        );
        scope.assert.deepEqual(await readdir(fixture.directory), []);
        return scope.assert.collect();
    })
]);
