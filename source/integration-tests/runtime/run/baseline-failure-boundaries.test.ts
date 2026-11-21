import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { defineReporter } from '../../../packages/engine/engine.entry-point.ts';
import {
    orchestrator,
    createHistory,
    readOrdinaryBaselineReport,
    type RunnerResult,
    RunResolutionError,
    type RunCommand,
    type BaselineRunResult
} from '../../../packages/run/run.entry-point.ts';
import {
    createOrdinaryBaselineFixture,
    ordinaryBaselineFixtureFile
} from '../../../test-support/ordinary-baseline-fixture.ts';
import { createBaselineCommands } from '../../../run/baseline-commands.ts';

const assertBlockedPublication = defineCompositeAssertion({
    name: 'blocked publication',
    assert(check, result: BaselineRunResult) {
        return check.group([
            check.equal(result.result.status, 'failed'),
            check.equal(result.writeOutcome.kind, 'blocked')
        ]);
    }
});

const assertReplayComparison = defineCompositeAssertion({
    name: 'replay comparison',
    assert(check, result: RunnerResult) {
        return check.group([
            check.equal(result.summary.failed, 2),
            check.deepEqual(result.runnerErrors, []),
            check.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'read-only')
        ]);
    }
});
export const testNode = suite('ordinary baseline failure boundaries', [
    test('replays a retained baseline update without writing changed proposals', async function (scope: TestScope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');

        const recordedBaselineUpdateCommand = {
            ...fixture.command,
            request: { ...fixture.command.request, record: true }
        };
        const recordedBaselineUpdateUpdated = await orchestrator.baseline.update(recordedBaselineUpdateCommand, {
            timing: null
        });
        scope.assert.equal(recordedBaselineUpdateUpdated.result.status, 'passed');
        const recordedBaselineUpdateRecords = await createHistory({
            projectRoot: recordedBaselineUpdateCommand.cwd,
            config: recordedBaselineUpdateCommand.config
        })
            .list();
        const [ record ] = recordedBaselineUpdateRecords;
        scope.require.defined(record);
        const runId = record.id;

        const original = await fixture.entries();
        fixture.setActual(43);
        const result = await orchestrator.replay({
            debug: { mode: 'off', selectors: [] },
            cwd: fixture.command.cwd,
            config: fixture.command.config,
            signal: null,
            runId
        });
        scope.assert(assertReplayComparison, result);
        scope.assert.deepEqual(await fixture.entries(), original);
        return scope.assert.collect();
    }),
    test('blocks every pending change when an observation fails', async function (scope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
        await orchestrator.baseline.update(fixture.command, { timing: null });
        const original = await fixture.entries();
        fixture.setActual(43);
        fixture.setMissingObservation(true);
        const result = await orchestrator.baseline.update(fixture.command, { timing: null });
        scope.assert(assertBlockedPublication, result);
        scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'artifact');
        scope.assert.deepEqual(await fixture.entries(), original);
        return scope.assert.collect();
    }),
    test('blocks successful case proposals when another case fails', async function (scope: TestScope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
        const profile = fixture.command.config.profiles.unit;
        scope.require.defined(profile);
        const command: RunCommand = {
            ...fixture.command,
            config: {
                ...fixture.command.config,
                profiles: {
                    unit: {
                        ...profile,
                        files: {
                            include: [
                                ordinaryBaselineFixtureFile,
                                'source/integration-tests/runtime/fixtures/ordinary-baseline-failure.test.ts'
                            ],
                            exclude: []
                        }
                    }
                }
            }
        };
        const result = await orchestrator.baseline.apply(command, { timing: null });
        scope.assert.equal(result.result.summary.failed, 1);
        scope.assert.equal(result.changes.length, 2);
        scope.assert.equal(result.writeOutcome.kind, 'blocked');
        scope.assert.deepEqual(await fixture.entries(), []);
        return scope.assert.collect();
    }),
    test('preserves completed writes when final reporter delivery fails', async function (scope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
        const reporter = defineReporter(function () {
            return {
                kind: 'real-time',
                name: 'late-failure',
                dispose: null,
                onFinish: null,
                sinks: [ { kind: 'memory' } ],
                onEvent(event) {
                    if (event.kind === 'run-end') {
                        throw new Error('Late reporter failure.');
                    }
                }
            };
        });
        const command = { ...fixture.command, config: { ...fixture.command.config, reporters: [ reporter ] } };
        const result = await orchestrator.baseline.update(command, { timing: null });
        scope.assert.equal(result.result.status, 'failed');
        scope.assert.equal(result.result.runnerErrors[0]?.subtype, 'reporter');
        scope.assert.equal(result.writeOutcome.kind, 'written');
        const entries = await fixture.entries();
        scope.assert.equal(entries.length, 2);
        return scope.assert.collect();
    }),
    test('rejects write modes through ordinary run', async function (scope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');
        await scope.assert.rejects(
            async function () {
                return await orchestrator.run({
                    ...fixture.command,
                    request: {
                        ...fixture
                            .command
                            .request,
                        baselineUpdateMode: 'update'
                    }
                }, { timing: null });
            },
            { type: RunResolutionError }
        );
        scope.assert.deepEqual(await fixture.entries(), []);
        return scope.assert.collect();
    }),
    test(
        'returns a changed diff exit code even when comparison tolerance accepts it',
        async function (scope) {
            const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');

            await orchestrator.baseline.update(fixture.command, { timing: null });
            const establishToleratedChangeOriginal = await fixture.entries();
            fixture.setActual(43);
            fixture.setTolerance(1);
            const establishToleratedChangeCompared = await orchestrator.run(fixture.command, { timing: null });
            scope.assert.equal(establishToleratedChangeCompared.status, 'passed');
            const original = establishToleratedChangeOriginal;

            const commands = createBaselineCommands({
                async loadConfig() {
                    return { ...fixture.command.config, configPath: null };
                },
                async createDefaultReporter() {
                    throw new Error('Unexpected default reporter loading.');
                },
                orchestrator
            });
            const result = await commands.diff({
                cwd: fixture.command.cwd,
                configPath: null,
                runRequest: fixture.command.request
            });
            scope.assert.equal(result.exitCode, 1);
            scope.assert.equal(result.stdoutLines.length, 2);
            scope.assert.deepEqual(await fixture.entries(), original);
            return scope.assert.collect();
        }
    )
]);
