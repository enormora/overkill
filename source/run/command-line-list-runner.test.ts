import { defineMacro, type TestBody, type TestScope, suite, test } from '@overkill-dev/test';
import type { ConfiguredRunCommand, ResolvedRun, RunCommand, RunSelection } from '../packages/run/run.entry-point.ts';
import type { DefinedReporter } from '../packages/engine/engine.entry-point.ts';
import { defaultIntegrationProfile } from '../test-support/run-command-factory.ts';
import {
    passiveReporter,
    loadDefaultConfig,
    createResolvedRun,
    createListOnlyOrchestrator,
    createMemoryReporter,
    createDependencies,
    createListDependencies,
    listTests
} from '../test-support/command-line-list-runner-fixture.ts';
import { snapshotRunCommand } from './frozen-run-command.ts';
import { createCommandLineRunner } from './command-line-runner.ts';

const terminalReporter = passiveReporter('terminal', [ { kind: 'stdout-raw' } ]);

const listRunnerCase = defineMacro(function (title: string, body: TestBody) {
    return test({ body, title });
});

async function createResolvedRunWithOrphanLocation(
    suppliedCommand: ConfiguredRunCommand | RunCommand
): Promise<ResolvedRun> {
    const { command } = snapshotRunCommand(suppliedCommand);
    const resolvedRun = createResolvedRun(command, []);

    if (resolvedRun.plan.kind !== 'local') {
        throw new Error('Expected local resolved run.');
    }

    return {
        ...resolvedRun,
        plan: {
            collectedPlan: {
                implementations: null,

                family: null,
                defined: 1,
                discoveredFiles: [],
                files: [],
                orphans: [
                    {
                        definitionLocations: [ {
                            column: 11,
                            file: `${process.cwd()}/source/orphan.test.ts`,
                            kind: 'known' as const,
                            line: 7
                        } ],
                        file: null,
                        kind: 'suite',
                        title: 'unused'
                    }
                ],
                root: resolvedRun.plan.testPlan.root
            },
            kind: 'supervised'
        }
    };
}

async function resolvePassingCommand(suppliedCommand: ConfiguredRunCommand | RunCommand): Promise<ResolvedRun> {
    const { command } = snapshotRunCommand(suppliedCommand);
    return createResolvedRun(command, []);
}

async function createTerminalReporter(): Promise<DefinedReporter> {
    return terminalReporter;
}

export const testNode = suite('Command line list runner', [
    listRunnerCase(
        'commandLineRunner.listTests() renders the resolved plan tree without loading reporters',
        async function body(scope: TestScope) {
            let defaultReporterLoadCount = 0;
            const receivedCommands: RunCommand[] = [];
            const dependencies = createDependencies(
                createListOnlyOrchestrator(async function resolveCommand(command) {
                    receivedCommands.push(snapshotRunCommand(command).command);

                    return createResolvedRun(command, []);
                }),
                async function createCountingReporter() {
                    defaultReporterLoadCount += 1;

                    return terminalReporter;
                }
            );
            const result = await listTests(dependencies, false, false);

            scope.assert.deepEqual({ exitCode: result.exitCode, reporterLoadCount: defaultReporterLoadCount }, {
                exitCode: 0,
                reporterLoadCount: 0
            });
            scope.assert.deepEqual(result.stdoutLines, [
                'order=seeded seed=42',
                'source/a.test.ts',
                '  suite',
                '    passes'
            ]);
            scope.require.defined(receivedCommands[0]);
            scope.require.notNull(receivedCommands[0].config.reporters);
            scope.assert.deepEqual(receivedCommands[0].config.reporters, []);

            return scope.assert.collect();
        }
    ),
    listRunnerCase(
        'commandLineRunner.listTests() preserves list selection',
        async function body(scope: TestScope) {
            const receivedCommands: RunCommand[] = [];
            const integrationProfile = defaultIntegrationProfile({});
            const selection: RunSelection = {
                filter: { field: 'tag', kind: 'equals', value: 'fast' },
                kind: 'filter'
            };
            const dependencies = createListDependencies(
                async function resolveCommand(command) {
                    receivedCommands.push(snapshotRunCommand(command).command);

                    return createResolvedRun(command, []);
                },
                createTerminalReporter
            );
            const runner = createCommandLineRunner({
                ...dependencies,
                async loadConfig() {
                    const config = await loadDefaultConfig();

                    return {
                        ...config,
                        profiles: {
                            ...config.profiles,
                            integration: integrationProfile
                        }
                    };
                }
            });

            await runner.listTests({
                configPath: null,
                cwd: process.cwd(),
                listRequest: {
                    lastFailed: false,
                    order: 'seeded',
                    paths: [ 'source/integration.test.ts' ],
                    profile: 'integration',
                    seed: { value: 42n },
                    selection,
                    shard: { index: 1, total: 1 },
                    withLocations: false,
                    withOrphans: false
                }
            });

            scope.require.defined(receivedCommands[0]);
            scope.assert.deepEqual(receivedCommands[0].request.selection, selection);

            return scope.assert.collect();
        }
    ),
    listRunnerCase(
        'commandLineRunner.listTests() renders definition locations when requested',
        async function body(scope) {
            const result = await listTests(
                createListDependencies(resolvePassingCommand, createMemoryReporter),
                true,
                false
            );

            scope.assert.deepEqual(result.stdoutLines, [
                'order=seeded seed=42',
                'source/a.test.ts',
                '  suite (source/a.test.ts:3:5)',
                '    passes (source/a.test.ts:5:9)'
            ]);

            return scope.assert.collect();
        }
    ),
    listRunnerCase(
        'commandLineRunner.listTests() renders explicit orphan diagnostics',
        async function body(scope) {
            const result = await listTests(
                createListDependencies(resolvePassingCommand, createMemoryReporter),
                false,
                true
            );

            scope.assert.deepEqual(result.stdoutLines, [
                'order=seeded seed=42',
                'source/a.test.ts',
                '  suite',
                '    passes',
                'Orphans',
                '  (none)'
            ]);

            return scope.assert.collect();
        }
    ),
    listRunnerCase(
        'commandLineRunner.listTests() renders orphan definition locations when requested',
        async function body(scope) {
            const result = await listTests(
                createListDependencies(createResolvedRunWithOrphanLocation, createMemoryReporter),
                true,
                true
            );

            scope.assert.deepEqual(result.stdoutLines, [
                'order=seeded seed=42',
                'Orphans',
                '  suite: unused (<unknown>) (source/orphan.test.ts:7:11)'
            ]);

            return scope.assert.collect();
        }
    )
]);
