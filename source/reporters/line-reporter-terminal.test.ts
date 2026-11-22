import { suite, table, doubleUsage, testDouble, type TestDouble } from '@overkill-dev/test';

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
    table({
        title: 'renders terminal results with empty and nested suite names',
        cases: [
            {
                title: 'process exhaustion',
                caseId: failingCaseId,
                verdict: 'process-exhausted',
                durationMicroseconds: 12_000,
                message: 'fails (12 ms): process exhausted'
            },
            {
                title: 'crash',
                caseId: failingCaseId,
                verdict: 'crashed',
                durationMicroseconds: 13_000,
                message: 'fails (13 ms): crashed'
            },
            {
                title: 'nested crash',
                caseId: nestedFailingCaseId,
                verdict: 'crashed',
                durationMicroseconds: 14_000,
                message: '[root] nested fails (14 ms): crashed'
            }
        ] as const,
        caseTitle(row) {
            return row.title;
        },
        async test({ assert, parameters: { caseId, verdict, durationMicroseconds, message } }) {
            const log = testDouble<LogFunction>();
            const reporter = lineReporterWithLog(log);
            await reporter.onEvent({ kind: 'suite-start', suitePath: [] });
            await reporter.onEvent({
                property: null,
                benchmark: null,
                completion: 'final',
                attempt: 0,
                case: caseId,
                workId: { familyVariant: null, case: caseId, runtimes: [], workload: null },
                definitionLocations: [ definitionLocation ],
                artifacts: [],
                kind: 'test-end',
                outcome: null,
                suitePath: [],
                verdict,
                durationMicroseconds
            });
            assert(doubleUsage.calledOnceWithExactly, log, [ errorSymbol, message ]);
            return assert.collect();
        }
    })
]);
