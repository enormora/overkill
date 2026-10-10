import { writeFile } from 'node:fs/promises';
import type { CommandLineBenchmarkCommands } from '../../packages/run/command-line.entry-point.ts';
import { suite, test, type TestScope } from '../../packages/test/test.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { createBenchmarkCommands } from '../../run/benchmark-commands.ts';
import {
    createBenchmarkBaselineFixture,
    readBaselineContents,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import { createNullReporter } from '../../reporters/null-reporter.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import { runIfMain } from '../direct-launcher.test.ts';

function baselineCommands(fixture: BaselineFixture): CommandLineBenchmarkCommands {
    const defaultReporter = createNullReporter();
    return createBenchmarkCommands({
        async createDefaultReporter() {
            return defaultReporter;
        },
        orchestrator,
        async loadConfig() {
            return { ...fixture.command.config, configPath: null };
        }
    });
}

const request = { configPath: null, cwd: process.cwd(), runRequest: { ...defaultRunRequest(), profile: null } };
const listRequest = { configPath: null, cwd: process.cwd(), listRequest: { paths: [], profile: null } };
const execution = { processModel: 'supervised-process', maxConcurrency: 1, scheduling: 'serial' } as const;

async function assertExistingDiff(
    scope: TestScope,
    fixture: BaselineFixture,
    commands: CommandLineBenchmarkCommands
): Promise<void> {
    const unchanged = await commands.baseline.diff(request);
    scope.assert.equal(unchanged.exitCode, 0);
    scope.assert.deepEqual(unchanged.stdoutLines, []);
    const original = await readBaselineContents(fixture);
    fixture.setOffset(10);
    const changed = await commands.baseline.diff(request);
    scope.assert.equal(changed.exitCode, 1);
    scope.assert.equal(changed.runResult?.status, 'passed');
    scope.assert.deepEqual(await readBaselineContents(fixture), original);
}

async function assertDiffExitCodes(scope: TestScope, fixture: BaselineFixture): Promise<void> {
    const commands = baselineCommands(fixture);
    const missing = await commands.baseline.diff(request);
    scope.assert.equal(missing.exitCode, 1);
    scope.assert.equal(missing.stdoutLines.length, 2);
    scope.assert.equal(missing.runResult?.status, 'passed');
    scope.assert.deepEqual(await readBaselineContents(fixture), []);
    const updated = await commands.baseline.update(request);
    scope.assert.equal(updated.exitCode, 0);
    await assertExistingDiff(scope, fixture, commands);
}

async function assertInvalidList(
    scope: TestScope,
    commands: CommandLineBenchmarkCommands
): Promise<void> {
    const invalid = await commands.baseline.list(listRequest);
    scope.assert.equal(invalid.exitCode, 2);
    scope.assert.equal(invalid.fallbackDiagnostics.length, 1);
    const unknown = await commands.baseline.list({ ...listRequest, listRequest: { paths: [], profile: 'missing' } });
    scope.assert.equal(unknown.exitCode, 3);
}

async function assertListExitCodes(scope: TestScope, fixture: BaselineFixture): Promise<void> {
    const commands = baselineCommands(fixture);
    await commands.baseline.bootstrap(request);
    const listed = await commands.baseline.list(listRequest);
    scope.assert.equal(listed.exitCode, 0);
    scope.assert.equal(listed.stdoutLines.length, 2);
    const entries = await orchestrator.bench.baseline.list({
        ...fixture.command,
        request: { paths: [], profile: 'startup' }
    });
    const [ entry ] = entries;
    scope.require.defined(entry);
    await writeFile(entry.path, '{');
    await assertInvalidList(scope, commands);
}

export const testNode = suite('benchmark baseline CLI results', [
    test('diff returns failure for changes while preserving baseline files', async function (scope: TestScope) {
        await assertDiffExitCodes(scope, await createBenchmarkBaselineFixture(scope, execution));
        return scope.assert.collect();
    }),
    test('list distinguishes storage failures from profile selection errors', async function (scope: TestScope) {
        await assertListExitCodes(scope, await createBenchmarkBaselineFixture(scope, execution));
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode, [ createLineReporter() ]);
