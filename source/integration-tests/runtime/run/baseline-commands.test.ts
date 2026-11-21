import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { orchestrator } from '../../../packages/run/run.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    ordinaryBaselineFixtureFile,
    type OrdinaryBaselineFixture
} from '../../../test-support/ordinary-baseline-fixture.ts';
import type {
    CommandLineBaselineCommands,
    CommandLineBaselineRequest,
    CommandLineRunnerResult
} from '../../../run/command-line-command.ts';
import { createBaselineCommands } from '../../../run/baseline-commands.ts';

type CommandFixture = {
    readonly data: OrdinaryBaselineFixture;
    readonly commands: CommandLineBaselineCommands;
    readonly request: CommandLineBaselineRequest;
};
async function commandFixture(cleanup: TestScope['cleanup'], payload: 'binary' | 'text'): Promise<CommandFixture> {
    const data = await createOrdinaryBaselineFixture(cleanup, 'in-process', payload);
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
const commandChecks = async (
    check: CompositeCheckBuilder<'assert'>,
    result: Promise<CommandLineRunnerResult>,
    exitCode: number,
    lines: number
): Promise<CompositeAssertionReturn<'assert'>> => {
    const completed = await result;
    return check.group([ check.equal(completed.exitCode, exitCode), check.equal(completed.stdoutLines.length, lines) ]);
};
const assertCommand = defineCompositeAssertion({
    name: 'command',
    assert: commandChecks
});
const establishBaselines = defineCompositeAssertion({
    name: 'establish baselines',
    async assert(check, fixture: CommandFixture) {
        const initialChecks = check.group([
            await commandChecks(check.annotated('command'), fixture.commands.diff(fixture.request), 1, 2),
            check.deepEqual(await fixture.data.entries(), []),
            await commandChecks(check.annotated('command'), fixture.commands.bootstrap(fixture.request), 0, 2)
        ]);
        const entries = await fixture.data.entries();
        return check.group([
            initialChecks,
            check.equal(entries.length, 2),
            await commandChecks(check.annotated('command'), fixture.commands.diff(fixture.request), 0, 0)
        ]);
    }
});
const assertToleratedDiff = defineCompositeAssertion({
    name: 'tolerated diff',
    async assert(check, fixture: CommandFixture) {
        fixture.data.setTolerance(1);
        const diff = await fixture.commands.diff(fixture.request);
        return check.group([
            check.equal(diff.runResult?.status, 'passed'),
            check.equal(diff.exitCode, 1),
            check.equal(diff.stdoutLines.length, 2)
        ]);
    }
});
const seedStaleRecord = defineCompositeAssertion({
    name: 'seed stale record',
    async assert(check, fixture: CommandFixture) {
        const initialChecks = await commandChecks(
            check.annotated('command'),
            fixture.commands.update(fixture.request),
            0,
            2
        );
        const [ entry ] = await fixture.data.entries();
        if (entry === undefined || entry === null) {
            return check.group([ initialChecks, check.defined(entry) ]);
        }
        const intermediateChecks = check.defined(entry);
        const store = await fixture.data.store();
        await store.apply({
            kind: 'create',
            baseline: {
                ...entry.baseline,
                work: { ...entry.baseline.work, case: { ...entry.baseline.work.case, title: 'removed' } }
            }
        });
        return check.group([ initialChecks, intermediateChecks ]);
    }
});
const assertReadOnlyCleanup = defineCompositeAssertion({
    name: 'read only cleanup',
    async assert(check, fixture: CommandFixture) {
        const original = await fixture.data.entries();
        const initialChecks = check.equal(original.length, 3);
        const compared = await orchestrator.run(fixture.data.command, { timing: null });
        return check.group([
            initialChecks,
            check.equal(compared.status, 'failed'),
            check.equal(compared.runnerErrors[0]?.subtype, 'artifact'),
            await commandChecks(check.annotated('command'), fixture.commands.update(fixture.request), 0, 1),
            await commandChecks(
                check.annotated('command'),
                fixture
                    .commands
                    .apply({
                        ...fixture.request,
                        runRequest: { ...fixture.request.runRequest, paths: [ ordinaryBaselineFixtureFile ] }
                    }),
                0,
                0
            ),
            check.deepEqual(await fixture.data.entries(), original),
            await commandChecks(check.annotated('command'), fixture.commands.diff(fixture.request), 1, 1),
            check.deepEqual(await fixture.data.entries(), original)
        ]);
    }
});
const assertUnknownProfile = defineCompositeAssertion({
    name: 'unknown profile',
    async assert(check, result: Promise<CommandLineRunnerResult>) {
        const completed = await result;
        return check.group([
            check.equal(completed.exitCode, 3),
            check.equal(completed.runResult, null),
            check.true(completed.fallbackDiagnostics.some(function unknownProfile(line) {
                return line.includes('unknown');
            }))
        ]);
    }
});
const assertListing = defineCompositeAssertion({
    name: 'listing',
    async assert(check, fixture: CommandFixture, paths: readonly string[]) {
        const listed = await fixture.commands.list({
            cwd: fixture.request.cwd,
            configPath: null,
            listRequest: { profile: 'unit', paths }
        });
        return check.group([
            check.equal(listed.exitCode, 0),
            check.equal(listed.runResult, null),
            check.equal(listed.stdoutLines.length, 2)
        ]);
    }
});
export const testNode = suite('ordinary baseline commands', [
    test('bootstraps missing records and preserves mismatched expectations', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'text');
        await scope.assert(establishBaselines, fixture);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        await scope.assert(assertCommand, fixture.commands.bootstrap(fixture.request), 1, 0);
        scope.assert.deepEqual(await fixture.data.entries(), original);
        return scope.assert.collect();
    }),
    test('returns a changed diff despite comparison tolerance without writing', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'text');
        await scope.assert(establishBaselines, fixture);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        await scope.assert(assertToleratedDiff, fixture);
        scope.assert.deepEqual(await fixture.data.entries(), original);
        await scope.assert(assertCommand, fixture.commands.update(fixture.request), 0, 2);
        scope.assert.notDeepEqual(await fixture.data.entries(), original);
        await scope.assert(assertCommand, fixture.commands.diff(fixture.request), 0, 0);
        return scope.assert.collect();
    }),
    test('blocks an entire update when an observation is missing', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'binary');
        await scope.assert(assertCommand, fixture.commands.update(fixture.request), 0, 2);
        const original = await fixture.data.entries();
        fixture.data.setActual(43);
        fixture.data.setMissingObservation(true);
        const blocked = await fixture.commands.update(fixture.request);
        scope.assert.equal(blocked.exitCode, 2);
        scope.assert.equal(blocked.runResult?.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(await fixture.data.entries(), original);
        return scope.assert.collect();
    }),
    test('lists stored entries by file, directory, and glob without observing', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'text');
        await scope.assert(assertCommand, fixture.commands.update(fixture.request), 0, 2);
        const observed = fixture.data.observations();
        for (
            const paths of [
                [],
                [ ordinaryBaselineFixtureFile ],
                [ 'source/integration-tests/runtime/fixtures/' ],
                [
                    'source/**/*.test.ts'
                ],
                [ ordinaryBaselineFixtureFile.replaceAll('/', '\\') ]
            ]
        ) {
            await scope.assert(assertListing, fixture, paths);
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
    test('removes stale records only after a complete successful apply', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'text');
        await scope.assert(seedStaleRecord, fixture);
        await scope.assert(assertReadOnlyCleanup, fixture);
        await scope.assert(assertCommand, fixture.commands.apply(fixture.request), 0, 1);
        const remaining = await fixture.data.entries();
        scope.assert.equal(remaining.length, 2);
        return scope.assert.collect();
    }),
    test('returns configuration diagnostics for unknown profiles', async function (scope) {
        const fixture = await commandFixture(scope.cleanup, 'text');
        await scope.assert(
            assertUnknownProfile,
            fixture.commands.update({
                ...fixture.request,
                runRequest: { ...fixture.request.runRequest, profile: 'unknown' }
            })
        );
        await scope.assert(
            assertUnknownProfile,
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
