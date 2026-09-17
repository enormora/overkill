import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createCommandLineRunner } from './command-line-runner.ts';
import {
    createListDependencies,
    createMemoryReporter,
    createResolvedRun,
    listTests
} from './command-line-list-runner.test.ts';
import { RunCollectionError } from './run-errors.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-list-runner-errors.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps collection runner errors without printing the plan',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await listTests(
                    createListDependencies(async function resolveCommand(command) {
                        return createResolvedRun(command, [
                            {
                                attributedTo: null,
                                cause: null,
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
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps config load errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runner = createCommandLineRunner({
                    ...createListDependencies(async function resolveCommand(command) {
                        return createResolvedRun(command, []);
                    }, createMemoryReporter),
                    async loadRunConfig() {
                        throw new Error('Config failed.');
                    }
                });
                const result = await runner.listTests({
                    configPath: null,
                    cwd: process.cwd(),
                    listRequest: {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps thrown collection errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
