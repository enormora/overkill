import type { WallClock } from '@enormora/wall-clock';
import type { CaseId } from './identity.ts';
import type { RunResult, RunnerError, TestOutcome } from './run-result.ts';

export type RunFacts = Readonly<Record<string, unknown>>;

export type StandardOutputSinkDeclaration = {
    readonly conflictPolicy: 'exclusive' | 'shared';
    readonly kind: 'stderr' | 'stdout';
};

export type FileSinkDeclaration = {
    readonly conflictPolicy: 'exclusive';
    readonly kind: 'file';
    readonly path: string;
};

export type DirectorySinkDeclaration = {
    readonly conflictPolicy: 'exclusive';
    readonly kind: 'directory';
    readonly path: string;
};

export type MemorySinkDeclaration = {
    readonly conflictPolicy: 'shared';
    readonly kind: 'memory';
};

export type StreamSinkDeclaration = {
    readonly conflictPolicy: 'exclusive';
    readonly kind: 'stream';
    readonly provided: WritableStream<unknown>;
};

type FileSystemSinkDeclaration = DirectorySinkDeclaration | FileSinkDeclaration;
type PrivateSinkDeclaration = MemorySinkDeclaration | StreamSinkDeclaration;
type ReporterSinkDeclaration = FileSystemSinkDeclaration | StandardOutputSinkDeclaration;

export type SinkDeclaration = PrivateSinkDeclaration | ReporterSinkDeclaration;

type RunStartReporterEvent = {
    readonly facts: RunFacts;
    readonly kind: 'run-start';
    readonly startedAt: string;
};

type RunEndReporterEvent = {
    readonly kind: 'run-end';
    readonly result: RunResult;
};

type RunnerErrorReporterEvent = {
    readonly error: RunnerError;
    readonly kind: 'runner-error';
};

type SuiteStartReporterEvent = {
    readonly kind: 'suite-start';
    readonly suitePath: readonly string[];
};

type SuiteEndReporterEvent = {
    readonly kind: 'suite-end';
    readonly suitePath: readonly string[];
};

type TestStartReporterEvent = {
    readonly attempt: number;
    readonly case: CaseId;
    readonly kind: 'test-start';
};

type TestProgressReporterEvent = {
    readonly attempt: number;
    readonly case: CaseId;
    readonly kind: 'test-progress';
    readonly note: string;
};

type TestEndReporterEvent = {
    readonly attempt: number;
    readonly case: CaseId;
    readonly kind: 'test-end';
    readonly outcome: TestOutcome;
    readonly verdict: TestOutcome['kind'];
    readonly wallTimeMs: number;
};

type RunReporterEvent = RunEndReporterEvent | RunnerErrorReporterEvent | RunStartReporterEvent;
type SuiteReporterEvent = SuiteEndReporterEvent | SuiteStartReporterEvent;
type TestReporterEvent = TestEndReporterEvent | TestProgressReporterEvent | TestStartReporterEvent;

export type ReporterEvent = RunReporterEvent | SuiteReporterEvent | TestReporterEvent;

export type RealTimeReporter = {
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onEvent: (event: ReporterEvent) => Promise<void> | void;
    readonly onFinish: ((result: RunResult) => Promise<void> | void) | null;
};

export type FinalResultReporter = {
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onResult: (result: RunResult) => Promise<void> | void;
};

export type Reporter = FinalResultReporter | RealTimeReporter;

export type ReporterDispatcher = {
    readonly reportEvent: (
        reporters: readonly Reporter[],
        event: ReporterEvent
    ) => Promise<readonly RunnerError[]>;
    readonly reportResult: (
        reporters: readonly Reporter[],
        result: RunResult
    ) => Promise<readonly RunnerError[]>;
};

export type ReporterDispatcherDependencies = {
    readonly wallClock: WallClock;
};

const callbackTimeoutMs = 100;

type ReporterCallbackFailure = {
    readonly error: RunnerError;
    readonly reporter: Reporter;
};

type ClaimedSink = {
    readonly conflictPolicy: 'exclusive' | 'shared';
};

function standardOutputSinkKey(sink: StandardOutputSinkDeclaration): string {
    return `standard-output:${sink.kind}`;
}

function pathSinkKey(sink: DirectorySinkDeclaration | FileSinkDeclaration): string {
    return `path:${sink.path}`;
}

type ReporterTimeout = {
    readonly cancel: () => void;
    readonly promise: Promise<never>;
};

function validateStandardOutputSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: StandardOutputSinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    const key = standardOutputSinkKey(sink);
    const existingSink = claimedSinks.get(key);

    if (
        existingSink !== undefined &&
        (existingSink.conflictPolicy === 'exclusive' || sink.conflictPolicy === 'exclusive')
    ) {
        throw new TypeError(`Reporter sink conflict: ${sink.kind} is claimed exclusively.`);
    }

    const updatedSinks = new Map(claimedSinks);

    return updatedSinks.set(key, {
        conflictPolicy: sink.conflictPolicy
    });
}

function validatePathSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: DirectorySinkDeclaration | FileSinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    const key = pathSinkKey(sink);

    if (claimedSinks.has(key)) {
        throw new TypeError(`Reporter sink conflict: path "${sink.path}" is claimed by multiple reporters.`);
    }

    const updatedSinks = new Map(claimedSinks);

    return updatedSinks.set(key, {
        conflictPolicy: sink.conflictPolicy
    });
}

function validateReporterSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: SinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    if (sink.kind === 'stdout' || sink.kind === 'stderr') {
        return validateStandardOutputSink(claimedSinks, sink);
    }
    if (sink.kind === 'file' || sink.kind === 'directory') {
        return validatePathSink(claimedSinks, sink);
    }

    return claimedSinks;
}

export function validateReporterSinks(reporters: readonly Reporter[]): void {
    let claimedSinks: ReadonlyMap<string, ClaimedSink> = new Map();

    for (const reporter of reporters) {
        for (const sink of reporter.sinks) {
            claimedSinks = validateReporterSink(claimedSinks, sink);
        }
    }
}

function formatReporterError(reporter: Reporter, cause: unknown): RunnerError {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return {
        attributedTo: null,
        cause,
        message: `${reporter.name}: ${reason}`,
        subtype: 'reporter'
    };
}

function timeoutError(reporter: Reporter): Error {
    return new Error(`${reporter.name} reporter callback timed out after ${callbackTimeoutMs} ms.`);
}

async function runReporterCallback(callback: () => Promise<void> | void): Promise<void> {
    await callback();
}

export function createReporterDispatcher(dependencies: ReporterDispatcherDependencies): ReporterDispatcher {
    const { wallClock } = dependencies;

    function createReporterTimeout(reporter: Reporter): ReporterTimeout {
        const { promise, reject } = Promise.withResolvers<never>();
        const timeout = wallClock.setTimeout(function rejectTimedOutCallback() {
            reject(timeoutError(reporter));
        }, callbackTimeoutMs);

        return {
            cancel() {
                wallClock.clearTimeout(timeout);
            },
            promise
        };
    }

    async function awaitReporterCallback(
        reporter: Reporter,
        callback: () => Promise<void> | void
    ): Promise<RunnerError | null> {
        const reporterTimeout = createReporterTimeout(reporter);
        try {
            await Promise.race([ runReporterCallback(callback), reporterTimeout.promise ]);

            return null;
        } catch (error: unknown) {
            return formatReporterError(reporter, error);
        } finally {
            reporterTimeout.cancel();
        }
    }

    async function reportEventToReporter(
        reporter: RealTimeReporter,
        event: ReporterEvent
    ): Promise<ReporterCallbackFailure | null> {
        const error = await awaitReporterCallback(reporter, function sendReporterEvent(): Promise<void> | void {
            return reporter.onEvent(event);
        });

        if (error === null) {
            return null;
        }

        return { error, reporter };
    }

    async function reportRunnerErrorToOtherReporters(
        reporters: readonly Reporter[],
        failedReporter: Reporter,
        error: RunnerError
    ): Promise<readonly RunnerError[]> {
        const event: ReporterEvent = { error, kind: 'runner-error' };
        const failures = await Promise.all(
            reporters.map(async function reportRunnerError(reporter): Promise<ReporterCallbackFailure | null> {
                if (reporter.kind !== 'real-time' || reporter === failedReporter) {
                    return null;
                }

                return reportEventToReporter(reporter, event);
            })
        );

        return failures.flatMap(function collectFailure(failure) {
            return failure === null ? [] : [ failure.error ];
        });
    }

    async function collectReporterErrorsWithNotifications(
        reporters: readonly Reporter[],
        reporterErrors: readonly ReporterCallbackFailure[]
    ): Promise<readonly RunnerError[]> {
        const notificationErrors = await Promise.all(
            reporterErrors.map(async function reportError(failure) {
                return reportRunnerErrorToOtherReporters(reporters, failure.reporter, failure.error);
            })
        );

        return [
            ...reporterErrors.map(function toError(failure) {
                return failure.error;
            }),
            ...notificationErrors.flat()
        ];
    }

    async function reportEvent(
        reporters: readonly Reporter[],
        event: ReporterEvent
    ): Promise<readonly RunnerError[]> {
        const failures = await Promise.all(
            reporters.map(async function reportRealTimeEvent(reporter): Promise<ReporterCallbackFailure | null> {
                if (reporter.kind !== 'real-time') {
                    return null;
                }

                return reportEventToReporter(reporter, event);
            })
        );

        const reporterErrors = failures.flatMap(function collectFailure(failure) {
            return failure === null ? [] : [ failure ];
        });

        if (event.kind === 'runner-error') {
            return reporterErrors.map(function toError(failure) {
                return failure.error;
            });
        }

        return collectReporterErrorsWithNotifications(reporters, reporterErrors);
    }

    async function reportResult(
        reporters: readonly Reporter[],
        result: RunResult
    ): Promise<readonly RunnerError[]> {
        const failures = await Promise.all(reporters.map(async function reportFinalResult(
            reporter
        ): Promise<ReporterCallbackFailure | null> {
            if (reporter.kind === 'final-result') {
                const error = await awaitReporterCallback(
                    reporter,
                    function reportResultToFinalReporter(): Promise<void> | void {
                        return reporter.onResult(result);
                    }
                );

                return error === null ? null : { error, reporter };
            }

            if (reporter.onFinish === null) {
                return null;
            }

            const { onFinish } = reporter;
            const error = await awaitReporterCallback(
                reporter,
                function reportResultToRealTimeReporter(): Promise<void> | void {
                    return onFinish(result);
                }
            );

            return error === null ? null : { error, reporter };
        }));

        const reporterErrors = failures.flatMap(function collectFailure(failure) {
            return failure === null ? [] : [ failure ];
        });

        return collectReporterErrorsWithNotifications(reporters, reporterErrors);
    }

    return { reportEvent, reportResult };
}
