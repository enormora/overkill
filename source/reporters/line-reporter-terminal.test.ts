import { suite, test, doubleUsage, testDouble, type TestDouble } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

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
        interactive: false,
        showPassing: true,
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)(createReportingContext({ projectRoot: null }));
}

export const testNode = suite('Line reporter terminal', [
    test('renders terminal test results and empty suite names', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log);

        await reporter.onEvent({ kind: 'suite-start', suitePath: [] });
        await reporter.onEvent({
            property: null,
            benchmark: null,
            completion: 'final',
            attempt: 0,
            case: failingCaseId,
            workId: { familyVariant: null, case: failingCaseId, runtimes: [], workload: null },
            definitionLocations: [ definitionLocation ],
            artifacts: [],
            kind: 'test-end',
            outcome: null,
            suitePath: [],
            verdict: 'process-exhausted',
            durationMicroseconds: 12_000
        });
        await reporter.onEvent({
            property: null,
            benchmark: null,
            completion: 'final',
            attempt: 0,
            case: failingCaseId,
            workId: { familyVariant: null, case: failingCaseId, runtimes: [], workload: null },
            definitionLocations: [ definitionLocation ],
            artifacts: [],
            kind: 'test-end',
            outcome: null,
            suitePath: [],
            verdict: 'crashed',
            durationMicroseconds: 13_000
        });
        await reporter.onEvent({
            property: null,
            benchmark: null,
            completion: 'final',
            attempt: 0,
            case: nestedFailingCaseId,
            workId: { familyVariant: null, case: nestedFailingCaseId, runtimes: [], workload: null },
            definitionLocations: [ definitionLocation ],
            artifacts: [],
            kind: 'test-end',
            outcome: null,
            suitePath: [],
            verdict: 'crashed',
            durationMicroseconds: 14_000
        });
        scope.assert(doubleUsage.callCount, log, 3);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            errorSymbol,
            'fails (12 ms): process exhausted'
        ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ errorSymbol, 'fails (13 ms): crashed' ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
            errorSymbol,
            '[root] nested fails (14 ms): crashed'
        ]);

        return scope.assert.collect();
    })
]);
