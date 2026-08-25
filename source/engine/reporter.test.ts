import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import {
    type FinalResultReporter,
    type ManagedStandardOutputSinkDeclaration,
    type ReporterEvent,
    type RealTimeReporter,
    ReporterSinkConflictError,
    type SinkDeclaration,
    validateReporterSinks
} from './reporter.ts';
import { createPlainOutputRenderer, type OutputLineIntent, type OutputRenderer } from './reporter-output.ts';
import { createReporterDispatcher, type ReporterDispatcher } from './reporter-dispatcher.ts';

function createFinalReporter(name: string, sinks: readonly SinkDeclaration[]): FinalResultReporter {
    return {
        dispose: null,
        kind: 'final-result',
        name,
        onResult() {
            return undefined;
        },
        sinks
    };
}

function createRealTimeReporter<
    const Sinks extends readonly [
        ManagedStandardOutputSinkDeclaration,
        ...ManagedStandardOutputSinkDeclaration[]
    ]
>(
    name: string,
    sinks: Sinks,
    output: readonly OutputLineIntent[]
): RealTimeReporter<Sinks> {
    return {
        dispose: null,
        kind: 'real-time',
        name,
        onEvent() {
            return output;
        },
        onFinish: null,
        sinks
    } as unknown as RealTimeReporter<Sinks>;
}

function createInvalidOutputReporter(
    name: string,
    sinks: readonly SinkDeclaration[],
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

type RecordingDispatcher = {
    readonly dispatcher: ReporterDispatcher;
    readonly stderrLines: readonly string[];
    readonly stdoutLines: readonly string[];
};

function createRecordingDispatcher(): RecordingDispatcher {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const wallClock = createDeterministicWallClock();

    function recordStderrLine(line: string): void {
        stderrLines.push(line);
    }

    function recordStdoutLine(line: string): void {
        stdoutLines.push(line);
    }

    const dispatcher = createReporterDispatcher({
        stderr: { writeLine: recordStderrLine },
        stdout: { writeLine: recordStdoutLine },
        wallClock
    });

    return {
        dispatcher,
        stderrLines,
        stdoutLines
    };
}

function ignoreOutputLine(): void {
    return undefined;
}

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

export const testSuite = createOverkillSuite({
    name: 'source/engine/reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'validateReporterSinks() allows managed supplemental standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                validateReporterSinks([
                    createFinalReporter('first', [ { kind: 'stdout-managed-supplemental' } ]),
                    createFinalReporter('second', [ { kind: 'stdout-managed-supplemental' } ])
                ]);
                scope.assert.true(true, { message: 'managed supplemental stdout sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() rejects raw standard output conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingStandardOutputSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [ { kind: 'stderr-raw' } ]),
                        createFinalReporter('second', [ { kind: 'stderr-managed-supplemental' } ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: stderr is claimed by incompatible reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() rejects duplicate managed primary standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingManagedOutputSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [ { kind: 'stdout-managed-primary' } ]),
                        createFinalReporter('second', [ { kind: 'stdout-managed-primary' } ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: stdout is claimed by incompatible reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() allows one managed primary with managed supplemental standard output sinks',
            metadata: {},
            body(scope: OverkillScope) {
                validateReporterSinks([
                    createFinalReporter('primary', [ { kind: 'stdout-managed-primary' } ]),
                    createFinalReporter('supplemental', [ { kind: 'stdout-managed-supplemental' } ])
                ]);
                scope.assert.true(true, { message: 'managed stdout primary and supplemental sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() rejects exact file and directory path conflicts',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function validateConflictingPathSinks() {
                    validateReporterSinks([
                        createFinalReporter('first', [
                            { kind: 'file', path: 'target/report' }
                        ]),
                        createFinalReporter('second', [
                            { kind: 'directory', path: 'target/report' }
                        ])
                    ]);
                }, {
                    message: 'Reporter sink conflict: path "target/report" is claimed by multiple reporters.',
                    type: ReporterSinkConflictError
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'validateReporterSinks() treats memory and stream sinks as private',
            metadata: {},
            body(scope: OverkillScope) {
                const stream = new WritableStream<unknown>();

                validateReporterSinks([
                    createFinalReporter('first', [
                        { kind: 'memory' },
                        { kind: 'stream', provided: stream }
                    ]),
                    createFinalReporter('second', [
                        { kind: 'memory' },
                        { kind: 'stream', provided: stream }
                    ])
                ]);
                scope.assert.true(true, { message: 'private sinks are valid' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records direct runner-error delivery failures without notification',
            metadata: {},
            async body(scope: OverkillScope) {
                const wallClock = createDeterministicWallClock();
                const dispatcher = createReporterDispatcher({
                    stderr: { writeLine: ignoreOutputLine },
                    stdout: { writeLine: ignoreOutputLine },
                    wallClock
                });
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-runner-error',
                    onEvent(event) {
                        if (event.kind === 'runner-error') {
                            throw new Error('cannot render runner error');
                        }
                    },
                    onFinish: null,
                    sinks: []
                };

                const errors = await dispatcher.reportEvent([ failingReporter ], {
                    error: {
                        attributedTo: null,
                        cause: new Error('original'),
                        message: 'original',
                        subtype: 'crash'
                    },
                    kind: 'runner-error'
                }, createPlainOutputRenderer());

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'broken-runner-error: cannot render runner error' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records runner-error notification output failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-event',
                    onEvent() {
                        throw new Error('cannot render event');
                    },
                    onFinish: null,
                    sinks: []
                };
                const notifyingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-notification-output',
                    onEvent(event: ReporterEvent) {
                        return event.kind === 'runner-error' ? [ stdoutPrimaryIntent ] : [];
                    },
                    onFinish: null,
                    sinks: []
                } as unknown as RealTimeReporter;

                const errors = await dispatcher.reportEvent(
                    [ failingReporter, notifyingReporter ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [
                        'broken-event: cannot render event',
                        'broken-notification-output: Reporter returned undeclared managed stdout output.'
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher reports non-error failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const failingReporter: RealTimeReporter = {
                    dispose: null,
                    kind: 'real-time',
                    name: 'broken-non-error',
                    async onEvent() {
                        const failure = Promise.withResolvers<never>();

                        failure.reject({
                            toString() {
                                return 'string failure';
                            }
                        });

                        return await failure.promise;
                    },
                    onFinish: null,
                    sinks: []
                };

                const errors = await dispatcher.reportEvent(
                    [ failingReporter ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.equal(errors[0]?.message, 'broken-non-error: string failure');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher writes managed output in reporter registration order',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher, stderrLines, stdoutLines } = createRecordingDispatcher();
                const errors = await dispatcher.reportEvent(
                    [
                        createRealTimeReporter('primary', [ { kind: 'stdout-managed-primary' } ], [
                            stdoutPrimaryIntent
                        ]),
                        createRealTimeReporter(
                            'supplemental',
                            [ { kind: 'stdout-managed-supplemental' } ],
                            [ stdoutSupplementalIntent ]
                        )
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(errors, []);
                scope.assert.deepEqual(stdoutLines, [ 'primary line', 'supplemental line' ]);
                scope.assert.deepEqual(stderrLines, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher writes managed stderr output',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher, stderrLines, stdoutLines } = createRecordingDispatcher();
                const errors = await dispatcher.reportEvent(
                    [
                        createRealTimeReporter(
                            'stderr',
                            [ { kind: 'stderr-managed-supplemental' } ],
                            [ stderrSupplementalIntent ]
                        )
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(errors, []);
                scope.assert.deepEqual(stdoutLines, []);
                scope.assert.deepEqual(stderrLines, [ 'stderr supplemental line' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records undeclared managed output as a reporter error',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await dispatcher.reportEvent(
                    [
                        createInvalidOutputReporter('undeclared-output', [], [ stdoutPrimaryIntent ])
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'undeclared-output: Reporter returned undeclared managed stdout output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records wrong-role managed output as a reporter error',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await dispatcher.reportEvent(
                    [
                        createInvalidOutputReporter(
                            'wrong-role-output',
                            [ { kind: 'stdout-managed-supplemental' } ],
                            [ stdoutPrimaryIntent ]
                        )
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'wrong-role-output: Reporter returned undeclared managed stdout output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records invalid managed output as a reporter error',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const errors = await dispatcher.reportEvent(
                    [
                        createInvalidOutputReporter('invalid-output', [ { kind: 'stdout-managed-primary' } ], [
                            { annotation: null, kind: 'stdout-line', role: 'primary' }
                        ])
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    createPlainOutputRenderer()
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'invalid-output: Reporter returned invalid managed output.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reporter dispatcher records rendered newlines as a reporter error',
            metadata: {},
            async body(scope: OverkillScope) {
                const { dispatcher } = createRecordingDispatcher();
                const renderer: OutputRenderer = {
                    render() {
                        return 'bad\nline';
                    }
                };
                const errors = await dispatcher.reportEvent(
                    [
                        createRealTimeReporter('newline-output', [ { kind: 'stdout-managed-primary' } ], [
                            stdoutPrimaryIntent
                        ])
                    ],
                    { kind: 'suite-start', suitePath: [ 'suite' ] },
                    renderer
                );

                scope.assert.deepEqual(
                    errors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'newline-output: Managed output renderer returned a line containing a newline.' ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
