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
const failingCaseId = { file: null, title: 'fails', params: null, suite: [] };
const nestedFailingCaseId = { file: null, title: 'nested fails', params: null, suite: [ 'root' ] };
const definitionLocation = { kind: 'unknown' as const };

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 80,
        formatOptions: { color: false, wrap: true },
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)(createReportingContext({ projectRoot: null }));
}

function assertTerminalOutput(scope: OverkillScope, log: Log): void {
    scope.assert(doubleUsage.callCount, log, 3);
    scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
        errorSymbol,
        'fails (12 ms): resource exhausted'
    ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ errorSymbol, 'fails (13 ms): crashed' ]);
    scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
        errorSymbol,
        '[root] nested fails (14 ms): crashed'
    ]);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-terminal.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter renders terminal test results and empty suite names',
            annotations: {},
            controls: {},
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
                    durationMicroseconds: 12_000
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
                    durationMicroseconds: 13_000
                });
                await reporter.onEvent({
                    attempt: 0,
                    case: nestedFailingCaseId,
                    definitionLocations: [ definitionLocation ],
                    artifacts: [],
                    kind: 'test-end',
                    outcome: null,
                    suitePath: [],
                    verdict: 'crashed',
                    durationMicroseconds: 14_000
                });

                assertTerminalOutput(scope, log);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
