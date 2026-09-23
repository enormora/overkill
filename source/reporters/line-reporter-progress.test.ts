import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;
type LongCaseId = {
    readonly file: null;
    readonly params: null;
    readonly suite: readonly [string, string];
    readonly title: string;
};

const definitionLocation = { kind: 'unknown' as const };
const errorSymbol = colors.red(figures.cross);
const successSymbol = colors.green(figures.tick);

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 80,
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

function narrowLineReporterWithLog(log: Log, wrap: boolean): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 32,
        formatOptions: { color: false, wrap },
        stdoutConsole: { log },
        verbose: false
    };

    return createLineReporter(fakeDependencies)({
        relativizeLocationPath(location) {
            return location.file;
        }
    });
}

function suitePathFromTitles(
    titles: readonly string[]
): readonly { readonly definitionLocations: readonly [typeof definitionLocation]; readonly title: string; }[] {
    return titles.map(function toSuitePathEntry(title) {
        return { definitionLocations: [ definitionLocation ], title };
    });
}

function longCaseId(): LongCaseId {
    return {
        file: null,
        params: null,
        suite: [ 'top level suite', 'nested area' ],
        title: 'renders very long title'
    };
}

async function reportLongCase(reporter: RealTimeReporter): Promise<void> {
    const id = longCaseId();

    await reporter.onEvent({
        attempt: 0,
        case: id,
        definitionLocations: [ definitionLocation ],
        artifacts: [],
        kind: 'test-end',
        outcome: { kind: 'pass' },
        suitePath: suitePathFromTitles(id.suite),
        verdict: 'pass',
        durationMicroseconds: 6000
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-progress.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter wraps long progress lines under the message column',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = narrowLineReporterWithLog(log, true);

                await reportLongCase(reporter);

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    successSymbol,
                    '[top level suite > nested'
                ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  area] renders very long title' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  (6 ms)' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter can leave long progress lines unwrapped',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = narrowLineReporterWithLog(log, false);

                await reportLongCase(reporter);

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    successSymbol,
                    '[top level suite > nested area] renders very long title (6 ms)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints runner errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    error: {
                        attributedTo: null,
                        cause: new Error('cannot render'),
                        diagnostics: [],
                        message: 'line: cannot render',
                        subtype: 'reporter'
                    },
                    kind: 'runner-error'
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    errorSymbol,
                    'Runner error: line: cannot render'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
