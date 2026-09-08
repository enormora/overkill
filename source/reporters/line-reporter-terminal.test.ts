import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);
const failingCaseId = { file: null, title: 'fails', params: null, suite: [] };
const definitionLocation = { kind: 'unknown' as const };

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = { stdoutConsole: { log }, verbose: false };

    return createLineReporter(fakeDependencies)(createReportingContext({ projectRoot: null }));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-terminal.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter renders terminal test results and empty suite names',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({ kind: 'suite-start', suitePath: [] });
                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    definitionLocations: [ definitionLocation ],
                    artifacts: [],
                    kind: 'test-end',
                    outcome: null,
                    suitePath: [],
                    verdict: 'resource-exhausted',
                    wallTimeMs: 12
                });
                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    definitionLocations: [ definitionLocation ],
                    artifacts: [],
                    kind: 'test-end',
                    outcome: null,
                    suitePath: [],
                    verdict: 'crashed',
                    wallTimeMs: 13
                });

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ infoSymbol, '' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [
                    errorSymbol,
                    '  fails (12 ms): resource exhausted'
                ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ errorSymbol, '  fails (13 ms): crashed' ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
