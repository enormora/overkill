import { writeFile } from 'node:fs/promises';
import {
    type CompositeAssertionReturn,
    type CompositeCheckBuilder,
    defineCompositeAssertion
} from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';

import type { CommandLineBenchmarkCommands } from '../../packages/run/command-line.entry-point.ts';
import { orchestrator } from '../../packages/run/run.entry-point.ts';
import { createBenchmarkCommands } from '../../run/benchmark-commands.ts';
import {
    createBenchmarkBaselineFixture,
    readBaselineContents,
    type BaselineFixture
} from '../../test-support/benchmark-baseline-fixture.ts';
import { createNullReporter } from '../../reporters/null-reporter.ts';
import { defaultRunRequest } from '../../test-support/run-command-factory.ts';

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

const existingDiffChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    fixture: BaselineFixture,
    commands: CommandLineBenchmarkCommands
): Promise<CompositeAssertionReturn<'assert'>> {
    const unchanged = await commands.baseline.diff(request);
    const initialChecks = check.group([
        check.equal(unchanged.exitCode, 0),
        check.deepEqual(unchanged.stdoutLines, [])
    ]);
    const original = await readBaselineContents(fixture);
    fixture.setOffset(10);
    const changed = await commands.baseline.diff(request);
    return check.group([
        initialChecks,
        check.equal(changed.exitCode, 1),
        check.equal(changed.runResult?.status, 'passed'),
        check.deepEqual(await readBaselineContents(fixture), original)
    ]);
};

const assertDiffExitCodes = defineCompositeAssertion({
    name: 'diff exit codes',
    async assert(check, fixture: BaselineFixture) {
        const commands = baselineCommands(fixture);
        const missing = await commands.baseline.diff(request);
        const initialChecks = check.group([
            check.equal(missing.exitCode, 1),
            check.equal(missing.stdoutLines.length, 2),
            check.equal(missing.runResult?.status, 'passed'),
            check.deepEqual(await readBaselineContents(fixture), [])
        ]);
        const updated = await commands.baseline.update(request);
        return check.group([
            initialChecks,
            check.equal(updated.exitCode, 0),
            await existingDiffChecks(check.annotated('existing diff'), fixture, commands)
        ]);
    }
});

const invalidListChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    commands: CommandLineBenchmarkCommands
): Promise<CompositeAssertionReturn<'assert'>> {
    const invalid = await commands.baseline.list(listRequest);
    const initialChecks = check.group([
        check.equal(invalid.exitCode, 2),
        check.equal(invalid.fallbackDiagnostics.length, 1)
    ]);
    const unknown = await commands.baseline.list({ ...listRequest, listRequest: { paths: [], profile: 'missing' } });
    return check.group([ initialChecks, check.equal(unknown.exitCode, 3) ]);
};

const assertListExitCodes = defineCompositeAssertion({
    name: 'list exit codes',
    async assert(check, fixture: BaselineFixture) {
        const commands = baselineCommands(fixture);
        await commands.baseline.bootstrap(request);
        const listed = await commands.baseline.list(listRequest);
        const initialChecks = check.group([
            check.equal(listed.exitCode, 0),
            check.equal(listed.stdoutLines.length, 2)
        ]);
        const entries = await orchestrator.bench.baseline.list({
            ...fixture.command,
            request: { paths: [], profile: 'startup' }
        });
        const [ entry ] = entries;
        if (entry === undefined) {
            return check.group([ initialChecks, check.defined(entry) ]);
        }

        await writeFile(entry.path, '{');
        return check.group([ initialChecks, await invalidListChecks(check.annotated('invalid list'), commands) ]);
    }
});

export const testNode = suite('benchmark baseline CLI results', [
    test('diff returns failure for changes while preserving baseline files', async function (scope) {
        await scope.assert(assertDiffExitCodes, await createBenchmarkBaselineFixture(scope.cleanup, execution));
        return scope.assert.collect();
    }),
    test('list distinguishes storage failures from profile selection errors', async function (scope) {
        await scope.assert(assertListExitCodes, await createBenchmarkBaselineFixture(scope.cleanup, execution));
        return scope.assert.collect();
    })
]);
