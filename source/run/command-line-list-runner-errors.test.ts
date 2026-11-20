import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { createCommandLineRunner } from './command-line-runner.ts';
import {
    createListDependencies,
    createMemoryReporter,
    createResolvedRun,
    listTests
} from './command-line-list-runner.test.ts';
import { RunCollectionError } from './run-errors.ts';

export const testNode = suite('source/run/command-line-list-runner-errors.test.ts', [
    test(
        'commandLineRunner.listTests() maps collection runner errors without printing the plan',
        async function (scope: OverkillScope) {
            const result = await listTests(
                createListDependencies(async function resolveCommand(command) {
                    return createResolvedRun(command, [
                        {
                            attributedToAttempt: null,
                            attributedTo: null,
                            cause: null,
                            diagnostics: [],
                            message: 'Collection failed.',
                            subtype: 'loader'
                        }
                    ]);
                }, createMemoryReporter),
                false,
                false
            );

            scope.assert.equal(result.exitCode, 2);
            scope.assert.deepEqual(result.stdoutLines, []);
            scope.assert.deepEqual(result.fallbackDiagnostics, [
                'Overkill runner error: Collection failed.'
            ]);

            return scope.assert.collect();
        }
    ),
    test('commandLineRunner.listTests() maps config load errors', async function (scope: OverkillScope) {
        const runner = createCommandLineRunner({
            ...createListDependencies(async function resolveCommand(command) {
                return createResolvedRun(command, []);
            }, createMemoryReporter),
            async loadConfig() {
                throw new Error('Config failed.');
            }
        });
        const result = await runner.listTests({
            configPath: null,
            cwd: process.cwd(),
            listRequest: {
                lastFailed: false,
                order: 'seeded',
                paths: [ 'source/a.test.ts' ],
                profile: 'microtest',
                seed: { value: 42n },
                selection: { kind: 'all' },
                shard: { index: 1, total: 1 },
                withLocations: false,
                withOrphans: false
            }
        });

        scope.assert.equal(result.exitCode, 70);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill internal error: Config failed.'
        ]);
        scope.assert.deepEqual(result.stdoutLines, []);

        return scope.assert.collect();
    }),
    test('commandLineRunner.listTests() maps thrown collection errors', async function (scope: OverkillScope) {
        const result = await listTests(
            createListDependencies(async function resolveCommand() {
                throw new RunCollectionError('Collection failed.', { cause: null }, 'loader');
            }, createMemoryReporter),
            false,
            false
        );

        scope.assert.equal(result.exitCode, 2);
        scope.assert.deepEqual(result.fallbackDiagnostics, [
            'Overkill runner error: Collection failed.'
        ]);
        scope.assert.deepEqual(result.stdoutLines, []);

        return scope.assert.collect();
    })
]);
