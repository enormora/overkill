import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createPlainOutputRenderer,
    defineOutputRenderer,
    type DefinedOutputRenderer,
    type OutputLineIntent,
    type OutputRenderer
} from './reporter-output.ts';
import { defineReporter, type DefinedReporter, type RealTimeReporter, type ReporterEvent } from './reporter.ts';
import { createReporterDispatcher, type ReporterDispatcher } from './reporter-dispatcher.ts';
import type { RunnerError } from './run-result.ts';

const definitionLocation = { kind: 'unknown' as const };

type RecordingDispatcher = {
    readonly dispatcher: ReporterDispatcher;
    readonly stderrLines: readonly string[];
    readonly stdoutLines: readonly string[];
};

const stdoutPrimaryIntent: OutputLineIntent = {
    annotation: null,
    kind: 'stdout-line',
    role: 'primary',
    text: 'primary line'
};

const stdoutSupplementalIntent: OutputLineIntent = {
    annotation: null,
    kind: 'stdout-line',
    role: 'supplemental',
    text: 'supplemental line'
};

const stderrSupplementalIntent: OutputLineIntent = {
    annotation: null,
    kind: 'stderr-line',
    role: 'supplemental',
    text: 'stderr supplemental line'
};

function suiteStartEvent(title: string): Extract<ReporterEvent, { readonly kind: 'suite-start'; }> {
    return {
        kind: 'suite-start',
        suitePath: [ { definitionLocations: [ definitionLocation ], title } ]
    };
}

function createRecordingDispatcher(): RecordingDispatcher {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const dispatcher = createReporterDispatcher({
        stderr: {
            writeLine(line) {
                stderrLines.push(line);
            }
        },
        stdout: {
            writeLine(line) {
                stdoutLines.push(line);
            }
        },
        wallClock: createDeterministicWallClock()
    });

    return {
        dispatcher,
        stderrLines,
        stdoutLines
    };
}

function defineRuntimeReporter(reporter: RealTimeReporter): DefinedReporter {
    return defineReporter(function createRuntimeReporter() {
        return reporter;
    });
}

async function reportEvent(
    dispatcher: ReporterDispatcher,
    reporters: readonly RealTimeReporter[],
    event: ReporterEvent,
    outputRenderer: DefinedOutputRenderer = createPlainOutputRenderer()
): Promise<readonly RunnerError[]> {
    const delivery = await dispatcher.createDelivery(reporters.map(defineRuntimeReporter), outputRenderer);

    return await delivery.reportEvent(event);
}

function createOutputReporter(
    name: string,
    sinks: RealTimeReporter['sinks'],
    output: unknown
): RealTimeReporter {
    return {
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return output;
        },
        onFinish: null,
        sinks
    } as unknown as RealTimeReporter;
}

function errorMessages(errors: readonly RunnerError[]): readonly string[] {
    return errors.map(function toMessage(error) {
        return error.message;
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/reporter-managed-output.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher writes managed output in reporter registration order',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher, stderrLines, stdoutLines } = createRecordingDispatcher();
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter('primary', [ { kind: 'stdout-managed-primary' } ], [
                            stdoutPrimaryIntent
                        ]),
                        createOutputReporter('supplemental', [ { kind: 'stdout-managed-supplemental' } ], [
                            stdoutSupplementalIntent
                        ])
                    ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(errors, []);
                scope.assert.deepEqual(stdoutLines, [ 'primary line', 'supplemental line' ]);
                scope.assert.deepEqual(stderrLines, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher writes managed stderr output',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher, stderrLines, stdoutLines } = createRecordingDispatcher();
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter('stderr', [ { kind: 'stderr-managed-supplemental' } ], [
                            stderrSupplementalIntent
                        ])
                    ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(errors, []);
                scope.assert.deepEqual(stdoutLines, []);
                scope.assert.deepEqual(stderrLines, [ 'stderr supplemental line' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records undeclared managed output as a reporter error',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter('undeclared-output', [], [ stdoutPrimaryIntent ])
                    ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(
                    errorMessages(errors),
                    [ 'undeclared-output: Reporter returned undeclared managed stdout output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records wrong-role managed output as a reporter error',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter(
                            'wrong-role-output',
                            [ { kind: 'stdout-managed-supplemental' } ],
                            [ stdoutPrimaryIntent ]
                        )
                    ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(
                    errorMessages(errors),
                    [ 'wrong-role-output: Reporter returned undeclared managed stdout output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records invalid managed output as a reporter error',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter('invalid-output', [ { kind: 'stdout-managed-primary' } ], [
                            { annotation: null, kind: 'stdout-line', role: 'primary' }
                        ])
                    ],
                    suiteStartEvent('suite')
                );

                scope.assert.deepEqual(
                    errorMessages(errors),
                    [ 'invalid-output: Reporter returned invalid managed output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'reporter dispatcher records rendered newlines as a reporter error',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const renderer: OutputRenderer = {
                    render() {
                        return 'bad\nline';
                    }
                };
                const errors = await reportEvent(
                    dispatcher,
                    [
                        createOutputReporter('newline-output', [ { kind: 'stdout-managed-primary' } ], [
                            stdoutPrimaryIntent
                        ])
                    ],
                    suiteStartEvent('suite'),
                    defineOutputRenderer(function createNewlineOutputRenderer() {
                        return renderer;
                    })
                );

                scope.assert.deepEqual(
                    errorMessages(errors),
                    [ 'newline-output: Managed output renderer returned a line containing a newline.' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
