import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RunResult } from '../../../packages/engine/engine.entry-point.ts';
import { collectedRunCommand, collectLifecycleRun } from '../../../test-support/collected-run-fixtures.ts';
import { defaultMicrotestProfile, defaultRunConfig } from '../../../test-support/run-command-factory.ts';
import type { RunCommand } from '../../../packages/run/run.entry-point.ts';

function coveredCommand(directory: string): RunCommand {
    const command = collectedRunCommand();
    return {
        ...command,
        config: defaultRunConfig({
            profiles: { microtest: defaultMicrotestProfile({
                execution: { processModel: 'in-process', scheduling: 'serial' },
                coverage: { outputs: [ 'json' ], sources: {
                    mode: 'all', include: [ 'source/integration-tests/run/fixtures/collected-subject.ts' ], exclude: []
                } }
            }) },
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

await mkdir('target', { recursive: true });
const directory = await mkdtemp(join(process.cwd(), 'target/collected-coverage-'));
try {
    const { collected } = await collectLifecycleRun(coveredCommand(directory));
    const first = await collected.run({ selection: { kind: 'all' } });
    const second = await collected.run({ selection: { kind: 'all' } });
    const directories = [ ...coverageDirectories(first), ...coverageDirectories(second) ];
    const files = await readdir(join(directory, 'runs'));
    const records = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => {
        return await readFile(join(directory, 'runs', file), 'utf8');
    }));
    assert.deepEqual({
        directoryCount: directories.length,
        freshDirectories: new Set(directories).size,
        completedRecords: records.filter(text => /"status":\s*"completed"/u.test(text)).length,
        statuses: [ first.status, second.status ]
    }, { directoryCount: 2, freshDirectories: 2, completedRecords: 2, statuses: [ 'passed', 'passed' ] });
    process.stdout.write('collected coverage sessions passed\n');
} finally {
    await rm(directory, { recursive: true, force: true });
}
