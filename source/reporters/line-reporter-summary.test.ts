import { type TestNode, suite, test, doubleUsage, testDouble, type TestDouble } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { preciseTimingReport, runTimingSummary } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const errorSymbol = colors.red(figures.cross);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 200,
        formatOptions: { color: false, wrap: true },
        interactive: false,
        showPassing: true,
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)({
        failureArtifacts: defaultFailureArtifactPolicy,
        relativizeLocationPath(location) {
            return location.file;
        }
    });
}

function requireFinish(reporter: RealTimeReporter): NonNullable<RealTimeReporter['onFinish']> {
    const { onFinish } = reporter;

    if (onFinish === null) {
        throw new TypeError('Expected line reporter to expose onFinish.');
    }

    return onFinish;
}

export const testNode: TestNode = suite('Line reporter summary', [
    test('retains lifetime findings from current runners', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);
        const result: RunResult = {
            ...runResultFactory.build({ status: 'failed', summary: { discovered: 1, planned: 1, passed: 1 } }),
            resourceChecks: [ {
                owner: { run: 'run', id: 'owner', scope: 'per-run' },
                resource: 'service',
                revision: 1,
                interval: { kind: 'lifetime' },
                passing: 0,
                errors: [],
                status: { kind: 'complete' },
                failures: [ {
                    target: 'connection',
                    check: {
                        kind: 'leaf',
                        id: 'service-invariant',
                        source: 'assert',
                        sourceLocations: [ { kind: 'unknown' } ],
                        path: [],
                        diff: null,
                        actual: { kind: 'boolean', value: false },
                        expected: { kind: 'boolean', value: true },
                        summary: 'Connection closed unexpectedly'
                    }
                } ]
            } ]
        };
        await requireFinish(reporter)({ result, context: { id: null, startedAt: null, facts: null } });
        scope.assert(doubleUsage.calledWith, log, [ '  service (connection)' ]);
        scope.assert(doubleUsage.calledWith, log, [ '  Connection closed unexpectedly' ]);
        return scope.assert.collect();
    }),
    test('accepts results from runners without resource checks', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);
        const { resourceChecks: _resourceChecks, ...legacy } = runResultFactory.build({
            summary: { discovered: 1, planned: 1, passed: 1 }
        });
        await Reflect.apply(requireFinish(reporter), reporter, [ {
            result: legacy,
            context: { id: null, startedAt: null, facts: null }
        } ]);
        scope.assert(doubleUsage.callCount, log, 2);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            colors.green(figures.tick),
            'Run passed · 1 passed · 0 ms'
        ]);
        return scope.assert.collect();
    }),
    test('prints slow runner overhead after the summary', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);
        const summary = runTimingSummary({
            testExecutionWallTimeMicroseconds: 1_000_000,
            totalWallTimeMicroseconds: 2_000_000
        });
        const runResult = runResultFactory.build({
            timings: {
                precise: preciseTimingReport({
                    aggregationMicroseconds: 0,
                    observationWindow: { durationMicroseconds: 600_000, startTimeUnixMicroseconds: 0 },
                    recordingMicroseconds: 0,
                    slowestSpanLimit: 50,
                    spanLimit: 5000,
                    spans: [ {
                        durationMicroseconds: 750_000,
                        kind: 'config.load',
                        label: null,
                        processId: null,
                        resource: null,
                        startOffsetMicroseconds: 0,
                        startTimeUnixMicroseconds: 0,
                        status: 'success',
                        workerId: null
                    } ]
                }),
                summary
            }
        });

        await requireFinish(reporter)({
            result: runResult,
            context: {
                id: null,
                startedAt: null,
                facts: null
            }
        });

        scope.assert(doubleUsage.callCount, log, 4);
        scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ 'Slow runner overhead:' ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '  config load: 750 ms' ]);

        return scope.assert.collect();
    }),
    test('prints the run count summary once the run finishes', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);
        const runResult: RunResult = runResultFactory.build({
            summary: {
                defined: 3,
                discovered: 4219,
                failed: 2,
                inconclusive: 0,
                passed: 4216,
                planned: 4219,
                skipped: 0
            },
            totalWallTimeMicroseconds: 10_120_000
        });

        await requireFinish(reporter)({
            result: runResult,
            context: {
                id: null,
                startedAt: null,
                facts: null
            }
        });

        scope.assert(doubleUsage.callCount, log, 2);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            errorSymbol,
            'Run failed · 2 failed · 4,216 passed · 10.12 s'
        ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 1, [
            '  4,218 executed · 4,219 planned · 4,219 discovered · 0 ms execution · 10.12 s overhead'
        ]);

        return scope.assert.collect();
    }),
    test(
        'prints nonzero neutral and terminal counts in the run summary',
        async function (scope) {
            const log = testDouble<LogFunction>();
            const reporter = lineReporterWithLog(log);
            const runResult: RunResult = runResultFactory.build({
                summary: {
                    crashed: 1,
                    discovered: 4,
                    failed: 1,
                    inconclusive: 1,
                    passed: 1,
                    planned: 4,
                    processExhausted: 1,
                    runtimePolicy: 1,
                    skipped: 1
                },
                totalWallTimeMicroseconds: 15_000
            });

            await requireFinish(reporter)({
                result: runResult,
                context: {
                    id: null,
                    startedAt: null,
                    facts: null
                }
            });

            scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                errorSymbol,
                'Run failed · 1 failed · 1 passed · 1 skipped · 1 inconclusive · ' +
                '1 process exhausted · 1 runtime policy · 1 crashed · 15 ms'
            ]);

            return scope.assert.collect();
        }
    )
]);
