import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const errorSymbol = colors.red(figures.cross);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 200,
        formatOptions: { color: false, wrap: true },
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)({
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-summary.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints the run count summary once the run finishes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);
                const runResult: RunResult = runResultFactory.build({
                    summary: {
                        defined: 3,
                        discovered: 3,
                        failed: 1,
                        inconclusive: 0,
                        passed: 2,
                        planned: 3,
                        skipped: 0
                    },
                    totalWallTimeMicroseconds: 10_000
                });

                await requireFinish(reporter)(runResult);

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    errorSymbol,
                    '3 discovered, 3 planned, 3 executed (2 pass, 1 fail, 0 skip) in 10 ms ' +
                    '(total 10 ms, execution 0 ms, overhead 10 ms)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints nonzero neutral and terminal counts in the run summary',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
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
                        resourceExhausted: 1,
                        runtimePolicy: 1,
                        skipped: 1
                    },
                    totalWallTimeMicroseconds: 15_000
                });

                await requireFinish(reporter)(runResult);

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    errorSymbol,
                    [
                        '4 discovered, 4 planned, 7 executed',
                        '(1 pass, 1 fail, 1 skip, 1 inconclusive, 1 resource-exhausted, 1 runtime-policy, 1 crash) ' +
                        'in 15 ms',
                        '(total 15 ms, execution 0 ms, overhead 15 ms)'
                    ]
                        .join(' ')
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
