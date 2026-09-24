import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '../packages/doubles/doubles.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

const successSymbol = colors.green(figures.tick);
const passingCaseId = { file: null, title: 'passes', params: null, suite: [] };
const skippedCaseId = { file: null, title: 'skips', params: null, suite: [] };
const definitionLocation = { kind: 'unknown' as const };

function lineReporterWithOptions(log: Log, verbose: boolean): RealTimeReporter {
    const fakeDependencies: LineReporterDependencies = {
        columns: 200,
        formatOptions: { color: false, wrap: true },
        stdoutConsole: { log },
        verbose
    };

    return createLineReporter(fakeDependencies)({
        relativizeLocationPath(location) {
            return location.file;
        }
    });
}

function lineReporterWithLog(log: Log): RealTimeReporter {
    return lineReporterWithOptions(log, false);
}

function suitePathFromTitles(
    titles: readonly string[]
): readonly { readonly definitionLocations: readonly [typeof definitionLocation]; readonly title: string; }[] {
    return titles.map(function toSuitePathEntry(title) {
        return { definitionLocations: [ definitionLocation ], title };
    });
}

function caseOutputArtifact(text: string): RunArtifact {
    return {
        id: {
            scope: {
                activeCases: [ passingCaseId ],
                case: passingCaseId,
                confidence: 'active-case',
                kind: 'case'
            },
            sequence: 0,
            subtype: 'log-capture'
        },
        payload: {
            byteLength: Buffer.byteLength(text),
            capturedAtMicroseconds: 1,
            kind: 'captured-output',
            stream: 'stdout',
            text,
            truncated: false
        },
        source: 'boundary-captured'
    };
}

function truncatedEmptyCaseOutputArtifact(): RunArtifact {
    return {
        ...caseOutputArtifact(''),
        payload: {
            byteLength: 0,
            capturedAtMicroseconds: 1,
            kind: 'captured-output',
            stream: 'stdout',
            text: '',
            truncated: true
        }
    };
}

function runOutputArtifact(text: string): RunArtifact {
    return {
        id: {
            scope: { kind: 'run' },
            sequence: 0,
            subtype: 'log-capture'
        },
        payload: {
            byteLength: Buffer.byteLength(text),
            capturedAtMicroseconds: 1,
            kind: 'captured-output',
            stream: 'stderr',
            text,
            truncated: false
        },
        source: 'boundary-captured'
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/line-reporter-artifacts.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter suppresses captured output for passing tests by default',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    artifacts: [ caseOutputArtifact('hidden output\n') ],
                    case: passingCaseId,
                    definitionLocations: [ definitionLocation ],
                    kind: 'test-end',
                    outcome: { kind: 'pass' },
                    suitePath: suitePathFromTitles(passingCaseId.suite),
                    verdict: 'pass',
                    durationMicroseconds: 3000
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ successSymbol, 'passes (3 ms)' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter defers captured output for passing tests in verbose mode',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithOptions(log, true);

                await reporter.onEvent({
                    attempt: 0,
                    artifacts: [ caseOutputArtifact('visible output\n') ],
                    case: passingCaseId,
                    definitionLocations: [ definitionLocation ],
                    kind: 'test-end',
                    outcome: { kind: 'pass' },
                    suitePath: suitePathFromTitles(passingCaseId.suite),
                    verdict: 'pass',
                    durationMicroseconds: 3000
                });

                scope.assert(doubleUsage.callCount, log, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter defers truncated empty captured output',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithOptions(log, true);

                await reporter.onEvent({
                    attempt: 0,
                    artifacts: [ truncatedEmptyCaseOutputArtifact() ],
                    case: passingCaseId,
                    definitionLocations: [ definitionLocation ],
                    kind: 'test-end',
                    outcome: { kind: 'pass' },
                    suitePath: suitePathFromTitles(passingCaseId.suite),
                    verdict: 'pass',
                    durationMicroseconds: 3000
                });

                scope.assert(doubleUsage.callCount, log, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter defers captured output for non-passing tests',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    artifacts: [ caseOutputArtifact('skip output\n') ],
                    case: skippedCaseId,
                    definitionLocations: [ definitionLocation ],
                    kind: 'test-end',
                    outcome: { kind: 'skip', reason: 'not supported' },
                    suitePath: suitePathFromTitles(skippedCaseId.suite),
                    verdict: 'skip',
                    durationMicroseconds: 4000
                });

                scope.assert(doubleUsage.callCount, log, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints run-level captured output for non-green runs',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onFinish?.(runResultFactory.build({
                    artifacts: [ runOutputArtifact('collection error output\n') ],
                    runnerErrors: [ { message: 'cannot collect', subtype: 'loader' } ],
                    summary: { failed: 1 }
                }));

                scope.assert(doubleUsage.callCount, log, 6);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ 'Problems' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '  stderr:' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 4, [ '  collection error output' ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
