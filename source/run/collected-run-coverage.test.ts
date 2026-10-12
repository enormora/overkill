import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createSuite, createTestCase, type RunResult } from '../packages/engine/engine.entry-point.ts';
import { collectedRunCommand, collectLifecycleRun } from '../test-support/collected-run-fixtures.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../test-support/run-command-factory.ts';
import type { RunCommand } from '../packages/run/run.entry-point.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

function coveredCommand(directory: string): RunCommand {
    const command = collectedRunCommand();
    return {
        ...command,
        config: defaultRunConfig({
            profiles: {
                microtest: defaultMicrotestProfile({
                    execution: { processModel: 'in-process', scheduling: 'serial' },
                    coverage: {
                        outputs: [ 'json' ],
                        sources: {
                            mode: 'all',
                            include: [ 'source/integration-tests/run/fixtures/collected-subject.ts' ],
                            exclude: []
                        }
                    }
                })
            },
            runtimeStateDir: relative(command.cwd, directory)
        }),
        request: { ...command.request, coverage: true }
    };
}

function coverageDirectories(result: RunResult): readonly string[] {
    return result.artifacts.flatMap(function artifactCoverageDirectory(artifact) {
        return artifact.source === 'v8-native' ? [ artifact.payload.directory ] : [];
    });
}

async function verifyCoveredInvocations(directory: string): Promise<{
    readonly directories: readonly string[];
    readonly records: readonly string[];
    readonly statuses: readonly string[];
}> {
    const { collected } = await collectLifecycleRun(coveredCommand(directory));
    const first = await collected.run({ selection: { kind: 'all' } });
    const second = await collected.run({ selection: { kind: 'all' } });
    const records = await readdir(join(directory, 'runs'));
    return {
        directories: [ ...coverageDirectories(first), ...coverageDirectories(second) ],
        records,
        statuses: [ first.status, second.status ]
    };
}

export const testNode = createSuite({
    ...metadata,
    title: 'collected plan coverage',
    children: [ createTestCase({
        ...metadata,
        title: 'explicit ordinary coverage creates a fresh session and completed record for each invocation',
        async body(scope) {
            await mkdir('target', { recursive: true });
            const directory = await mkdtemp(join(process.cwd(), 'target/collected-coverage-'));
            scope.cleanup(async function removeCoverageOutputs() {
                await rm(directory, { recursive: true, force: true });
            });
            const observed = await verifyCoveredInvocations(directory);
            const records = await Promise.all(
                observed
                    .records
                    .filter(function isRecord(file) {
                        return file.endsWith('.json');
                    })
                    .map(async function recordContents(file) {
                        return await readFile(join(directory, 'runs', file), 'utf8');
                    })
            );
            const directories = new Set(observed.directories);
            scope.assert.deepEqual({
                directoryCount: observed.directories.length,
                freshDirectories: directories.size,
                completedRecords: records
                    .filter(function completedRecord(text) {
                        return /"status":\s*"completed"/u.test(text);
                    })
                    .length,
                statuses: observed.statuses
            }, { directoryCount: 2, freshDirectories: 2, completedRecords: 2, statuses: [ 'passed', 'passed' ] });
            return scope.assert.collect();
        }
    }) ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
