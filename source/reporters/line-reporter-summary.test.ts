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

const infoSymbol = colors.cyan(figures.info);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

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
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints the run count summary once the run finishes',
            metadata: {},
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
                    wallTimeMs: 10
                });

                await requireFinish(reporter)(runResult);

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    '3 discovered, 3 planned, 3 executed (2 pass, 1 fail, 0 skip) in 10 ms'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints nonzero inconclusive and crash counts in the run summary',
            metadata: {},
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
                        skipped: 1
                    },
                    wallTimeMs: 15
                });

                await requireFinish(reporter)(runResult);

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    '4 discovered, 4 planned, 5 executed (1 pass, 1 fail, 1 skip, 1 inconclusive, 1 crash) in 15 ms'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
