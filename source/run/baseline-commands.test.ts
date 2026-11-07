import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { orchestrator } from '../packages/run/run.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    ordinaryBaselineFixtureFile,
    type OrdinaryBaselineFixture
} from '../test-support/ordinary-baseline-fixture.ts';
import type {
    CommandLineBaselineCommands,
    CommandLineBaselineRequest,
    CommandLineRunnerResult
} from './command-line-command.ts';
import { createBaselineCommands } from './baseline-commands.ts';

type CommandFixture = {
    readonly data: OrdinaryBaselineFixture;
    readonly commands: CommandLineBaselineCommands;
    readonly request: CommandLineBaselineRequest;
};
async function commandFixture(scope: TestScope, payload: 'binary' | 'text'): Promise<CommandFixture> {
    const data = await createOrdinaryBaselineFixture(scope, 'in-process', payload);
    const commands = createBaselineCommands({
        async loadConfig() {
            return { ...data.command.config, configPath: null };
        },
        async createDefaultReporter() {
            throw new Error('Unexpected default reporter loading.');
        },
        orchestrator
    });
    return { data, commands, request: { cwd: data.command.cwd, configPath: null, runRequest: data.command.request } };
}
async function assertCommand(
    scope: TestScope,
    result: Promise<CommandLineRunnerResult>,
    exitCode: number,
    lines: number
): Promise<void> {
    const completed = await result;
    scope.assert.equal(completed.exitCode, exitCode);
    scope.assert.equal(completed.stdoutLines.length, lines);
}
async function establishBaselines(scope: TestScope, fixture: CommandFixture): Promise<void> {
    await assertCommand(scope, fixture.commands.diff(fixture.request), 1, 2);
    scope.assert.deepEqual(await fixture.data.entries(), []);
    await assertCommand(scope, fixture.commands.bootstrap(fixture.request), 0, 2);
    const entries = await fixture.data.entries();
    scope.assert.equal(entries.length, 2);
    await assertCommand(scope, fixture.commands.diff(fixture.request), 0, 0);
}
async function assertToleratedDiff(scope: TestScope, fixture: CommandFixture): Promise<void> {
    fixture.data.setTolerance(1);
    const diff = await fixture.commands.diff(fixture.request);
    scope.assert.equal(diff.runResult?.status, 'passed');
    scope.assert.equal(diff.exitCode, 1);
    scope.assert.equal(diff.stdoutLines.length, 2);
}
async function seedStaleRecord(scope: TestScope, fixture: CommandFixture): Promise<void> {
    await assertCommand(scope, fixture.commands.update(fixture.request), 0, 2);
    const [ entry ] = await fixture.data.entries();
    scope.require.defined(entry);
    const store = await fixture.data.store();
    await store.apply({
        kind: 'create',
        baseline: {
            ...entry.baseline,
            work: { ...entry.baseline.work, case: { ...entry.baseline.work.case, title: 'removed' } }
        }
    });
}
async function assertReadOnlyCleanup(scope: TestScope, fixture: CommandFixture): Promise<void> {
    const original = await fixture.data.entries();
    scope.assert.equal(original.length, 3);
    await assertCommand(scope, fixture.commands.update(fixture.request), 0, 1);
    await assertCommand(
        scope,
        fixture.commands.apply({
            ...fixture.request,
            runRequest: { ...fixture.request.runRequest, paths: [ ordinaryBaselineFixtureFile ] }
        }),
        0,
        0
    );
    scope.assert.deepEqual(await fixture.data.entries(), original);
    await assertCommand(scope, fixture.commands.diff(fixture.request), 1, 1);
    scope.assert.deepEqual(await fixture.data.entries(), original);
}
async function assertUnknownProfile(scope: TestScope, result: Promise<CommandLineRunnerResult>): Promise<void> {
    const completed = await result;
    scope.assert.equal(completed.exitCode, 3);
    scope.assert.equal(completed.runResult, null);
    scope.assert.true(completed.fallbackDiagnostics.some(function unknownProfile(line) {
        return line.includes('unknown');
    }));
}
async function assertListing(scope: TestScope, fixture: CommandFixture, paths: readonly string[]): Promise<void> {
    const listed = await fixture.commands.list({
        cwd: fixture.request.cwd,
        configPath: null,
        listRequest: { profile: 'unit', paths }
    });
    scope.assert.equal(listed.exitCode, 0);
    scope.assert.equal(listed.runResult, null);
    scope.assert.equal(listed.stdoutLines.length, 2);
}
export const testNode = suite('ordinary baseline commands', [
    test('bootstraps missing records and preserves mismatched expectations', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'text');
        await establishBaselines(scope, fixture);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        await assertCommand(scope, fixture.commands.bootstrap(fixture.request), 1, 0);
        scope.assert.deepEqual(await fixture.data.entries(), original);
        return scope.assert.collect();
    }),
    test('returns a changed diff despite comparison tolerance without writing', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'text');
        await establishBaselines(scope, fixture);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        await assertToleratedDiff(scope, fixture);
        scope.assert.deepEqual(await fixture.data.entries(), original);
        await assertCommand(scope, fixture.commands.update(fixture.request), 0, 2);
        scope.assert.notDeepEqual(await fixture.data.entries(), original);
        await assertCommand(scope, fixture.commands.diff(fixture.request), 0, 0);
        return scope.assert.collect();
    }),
    test('blocks an entire update when an observation is missing', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'binary');
        await assertCommand(scope, fixture.commands.update(fixture.request), 0, 2);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        fixture.data.setMissingObservation(true);
        const blocked = await fixture.commands.update(fixture.request);
        scope.assert.equal(blocked.exitCode, 2);
        scope.assert.equal(blocked.runResult?.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(await fixture.data.entries(), original);
        return scope.assert.collect();
    }),
    test('lists stored entries by file, directory, and glob without observing', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'text');
        await assertCommand(scope, fixture.commands.update(fixture.request), 0, 2);
        const observed = fixture.data.observations();
        for (
            const paths of [ [], [ ordinaryBaselineFixtureFile ], [ 'source/integration-tests/run/fixtures/' ], [
                'source/**/*.test.ts'
            ], [ ordinaryBaselineFixtureFile.replaceAll('/', '\\') ] ]
        ) {
            await assertListing(scope, fixture, paths);
        }
        const absent = await fixture.commands.list({
            cwd: fixture.request.cwd,
            configPath: null,
            listRequest: { profile: 'unit', paths: [ 'unrelated.test.ts' ] }
        });
        scope.assert.deepEqual(absent.stdoutLines, []);
        scope.assert.equal(fixture.data.observations(), observed);
        return scope.assert.collect();
    }),
    test('removes stale records only after a complete successful apply', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'text');
        await seedStaleRecord(scope, fixture);
        await assertReadOnlyCleanup(scope, fixture);
        await assertCommand(scope, fixture.commands.apply(fixture.request), 0, 1);
        const remaining = await fixture.data.entries();
        scope.assert.equal(remaining.length, 2);
        return scope.assert.collect();
    }),
    test('returns configuration diagnostics for unknown profiles', async function (scope: TestScope) {
        const fixture = await commandFixture(scope, 'text');
        await assertUnknownProfile(
            scope,
            fixture.commands.update({
                ...fixture.request,
                runRequest: { ...fixture.request.runRequest, profile: 'unknown' }
            })
        );
        await assertUnknownProfile(
            scope,
            fixture.commands.list({
                cwd: fixture.request.cwd,
                configPath: null,
                listRequest: { profile: 'unknown', paths: [] }
            })
        );
        scope.assert.equal(fixture.data.observations(), 0);
        return scope.assert.collect();
    })
]);
