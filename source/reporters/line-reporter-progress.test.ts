import { type TestNode, suite, test, doubleUsage, testDouble, type TestDouble } from '@overkill-dev/test';

import figures from 'figures';
import colors from 'yoctocolors';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
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
const infoSymbol = colors.cyan(figures.info);
const successSymbol = colors.green(figures.tick);

function lineReporterWithLog(log: Log, showPassing: boolean, interactive: boolean): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 80,
        formatOptions: { color: false, wrap: true },
        interactive,
        showPassing,
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

function narrowLineReporterWithLog(log: Log, wrap: boolean): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 32,
        formatOptions: { color: false, wrap },
        interactive: wrap,
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

async function reportLongCase(reporter: RealTimeReporter, completion: 'final' | 'retry'): Promise<void> {
    const id = longCaseId();
    const retry = completion === 'retry';

    await reporter.onEvent({
        property: null,
        benchmark: null,
        completion,
        attempt: 0,
        case: id,
        workId: { familyVariant: null, case: id, runtimes: [], workload: null },
        definitionLocations: [ definitionLocation ],
        artifacts: [],
        kind: 'test-end',
        outcome: retry
            ? {
                kind: 'fail',
                failures: [ {
                    kind: 'body-error',
                    error: { name: 'Error', message: 'try again', stack: null, thrown: null }
                } ]
            }
            : { kind: 'pass' },
        suitePath: suitePathFromTitles(id.suite),
        verdict: retry ? 'fail' : 'pass',
        durationMicroseconds: 6000
    });
}

export const testNode: TestNode = suite('Line reporter progress', [
    test('aligns durations to the right when a test fits in the terminal', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log, true, true);

        await reportLongCase(reporter, 'final');

        scope.assert(doubleUsage.callCount, log, 1);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            successSymbol,
            '[top level suite > nested area] renders very long title'.padEnd(72) + '(6 ms)'
        ]);

        return scope.assert.collect();
    }),
    test('wraps long progress lines under the message column', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = narrowLineReporterWithLog(log, true);

        await reportLongCase(reporter, 'final');

        scope.assert(doubleUsage.callCount, log, 3);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            successSymbol,
            '[top level suite > nested'
        ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  area] renders very long title' ]);
        scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  (6 ms)' ]);

        return scope.assert.collect();
    }),
    test('can leave long progress lines unwrapped', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = narrowLineReporterWithLog(log, false);

        await reportLongCase(reporter, 'final');

        scope.assert(doubleUsage.callCount, log, 1);
        scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
            successSymbol,
            '[top level suite > nested area] renders very long title (6 ms)'
        ]);

        return scope.assert.collect();
    }),
    test('prints periodic progress without listing passing tests or counting retries', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log, false, false);

        for (let index = 0; index < 99; index += 1) {
            await reportLongCase(reporter, 'final');
        }
        await reportLongCase(reporter, 'retry');
        scope.assert(doubleUsage.callCount, log, 1);

        await reportLongCase(reporter, 'final');
        scope.assert(doubleUsage.callCount, log, 2);
        scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ infoSymbol, '100 tests completed' ]);

        return scope.assert.collect();
    }),
    test('prints runner errors', async function (scope) {
        const log = testDouble<LogFunction>();
        const reporter = lineReporterWithLog(log, true, false);

        await reporter.onEvent({
            error: {
                attributedToAttempt: null,
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
    })
]);
