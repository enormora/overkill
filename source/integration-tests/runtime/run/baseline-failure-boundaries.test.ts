import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';
import type { CommandLineRunnerResult } from '../../../packages/run/command-line.entry-point.ts';
import type { OrdinaryBaselineEntry } from '../../../run/baseline-record.ts';
import {
    type OrdinaryBaselineFixture,
    createOrdinaryBaselineFixture,
    matchingSavedBaselines,
    successfulBaselineUpdate,
    ordinaryBaselineFixtureFile
} from '../../../test-support/ordinary-baseline-fixture.ts';

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
type ToleratedBaselineChangeEvidence = {
    readonly result: CommandLineRunnerResult;
    readonly fixture: OrdinaryBaselineFixture;
    readonly establishToleratedChangeOriginal: readonly OrdinaryBaselineEntry[];
};

const toleratedBaselineChange = defineCompositeAssertion({
    name: 'tolerated baseline change',
    async assert(
        check,
        { result, fixture, establishToleratedChangeOriginal }: ToleratedBaselineChangeEvidence
    ) {
        return check.group([
            check.group([ check.equal(result.exitCode, 1), check.equal(result.stdoutLines.length, 2) ]),
            check.deepEqual(await fixture.entries(), establishToleratedChangeOriginal)
        ]);
    }
});

async function recordedRunId(command: RunCommand): Promise<string> {
    const [ record ] = await createHistory({ projectRoot: command.cwd, config: command.config }).list();
    if (record === undefined) {
        throw new Error('Expected a recorded baseline update.');
    }
    return record.id;
}
export const testNode = suite('ordinary baseline failure boundaries', [
    test('replays a retained baseline update without writing changed proposals', async function (scope) {
        const fixture = await createOrdinaryBaselineFixture(scope.cleanup, 'in-process', 'text');

        const recordedBaselineUpdateCommand = {
            ...fixture.command,
            request: { ...fixture.command.request, record: true }
        };
        await scope.assert(successfulBaselineUpdate, recordedBaselineUpdateCommand);
        const runId = await recordedRunId(recordedBaselineUpdateCommand);

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
        await scope.assert(
            defineCompositeAssertion({
                name: 'blocks every pending change when an observation fails',
                async assert(check) {
                    return check.group([
                        check.equal(result.result.runnerErrors[0]?.subtype, 'artifact'),
                        check.deepEqual(await fixture.entries(), original)
                    ]);
                }
            })
        );
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
        await scope.assert(
            defineCompositeAssertion({
                name: 'blocks successful case proposals when another case fails',
                async assert(check) {
                    return check.group([
                        check.equal(result.result.summary.failed, 1),
                        check.equal(result.changes.length, 2),
                        check.equal(result.writeOutcome.kind, 'blocked'),
                        check.deepEqual(await fixture.entries(), [])
                    ]);
                }
            })
        );
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
        scope.assert(
            defineCompositeAssertion({
                name: 'preserves completed writes when final reporter delivery fails',
                assert(check) {
                    return check.group([
                        check.equal(result.result.status, 'failed'),
                        check.equal(result.result.runnerErrors[0]?.subtype, 'reporter'),
                        check.equal(result.writeOutcome.kind, 'written')
                    ]);
                }
            })
        );
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
            await scope.assert(matchingSavedBaselines, fixture.command);

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
            await scope.assert(toleratedBaselineChange, { result, fixture, establishToleratedChangeOriginal });
            return scope.assert.collect();
        }
    )
]);
