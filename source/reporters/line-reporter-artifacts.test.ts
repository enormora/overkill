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
    const fakeDependencies: LineReporterDependencies = { stdoutConsole: { log }, verbose };

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
            capturedAtMilliseconds: 1,
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
            capturedAtMilliseconds: 1,
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
            capturedAtMilliseconds: 1,
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
                    wallTimeMs: 3
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ successSymbol, 'passes (3 ms)' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints captured output for passing tests in verbose mode',
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
                    wallTimeMs: 3
                });

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  stdout:' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  visible output' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints truncated empty captured output as a header',
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
                    wallTimeMs: 3
                });

                scope.assert(doubleUsage.callCount, log, 2);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  stdout truncated:' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'line reporter prints captured output for non-passing tests',
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
                    wallTimeMs: 4
                });

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  stdout:' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  skip output' ]);

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

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  stderr:' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  collection error output' ]);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
