import { AsyncLocalStorage } from 'node:async_hooks';
import type { WallClock } from '@enormora/wall-clock';
import type {
    OutputLineIntent,
    OutputLineWriter,
    OutputRenderer,
    ReporterOutput
} from './reporter-output.ts';
import type { Reporter, ReporterEvent } from './reporter.ts';
import type { RunResult, RunnerError } from './run-result.ts';

type RealTimeReporterInDispatch = Extract<Reporter, { readonly kind: 'real-time'; }>;

export type ReporterDispatcher = {
    readonly disposeReporters: (
        reporters: readonly Reporter[]
    ) => Promise<readonly RunnerError[]>;
    readonly reportEvent: (
        reporters: readonly Reporter[],
        event: ReporterEvent,
        outputRenderer: OutputRenderer
    ) => Promise<readonly RunnerError[]>;
    readonly reportResult: (
        reporters: readonly Reporter[],
        result: RunResult,
        outputRenderer: OutputRenderer
    ) => Promise<readonly RunnerError[]>;
    readonly trackRunnerErrorDelivery: <Result>(
        work: () => Promise<Result>
    ) => Promise<{
        readonly deliveredRunnerErrors: readonly RunnerError[];
        readonly result: Result;
    }>;
};

export type ReporterDispatcherDependencies = {
    readonly stderr: OutputLineWriter;
    readonly stdout: OutputLineWriter;
    readonly wallClock: WallClock;
};

type ReporterDispatchContext = {
    readonly dependencies: ReporterDispatcherDependencies;
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

type ReporterCallbackFailure = {
    readonly error: RunnerError;
    readonly kind: 'failure';
    readonly reporter: Reporter;
};

type ReporterCallbackSuccess = {
    readonly kind: 'success';
    readonly output: ReporterOutput;
    readonly reporter: Reporter;
};

type ReporterCallbackResult = ReporterCallbackFailure | ReporterCallbackSuccess;

type ReporterTimeout = {
    readonly cancel: () => void;
    readonly promise: Promise<never>;
};

type ReporterCallback = () => unknown;
type RunnerErrorDeliveryStore = {
    readonly deliveredRunnerErrors: () => readonly RunnerError[];
    readonly recordDeliveredRunnerError: (error: RunnerError) => void;
};

const callbackTimeoutMs = 100;
const runnerErrorDeliveryStorage = new AsyncLocalStorage<RunnerErrorDeliveryStore>();

function hasTerminalSink(sink: Reporter['sinks'][number]): boolean {
    return sink.kind.startsWith('stdout') || sink.kind.startsWith('stderr');
}

function hasTerminalReporter(reporter: Reporter): boolean {
    return reporter.sinks.some(hasTerminalSink);
}

function recordRunnerErrorDelivery(error: RunnerError): void {
    runnerErrorDeliveryStorage.getStore()?.recordDeliveredRunnerError(error);
}

function recordDeliveredRunnerErrorEvent(
    event: ReporterEvent,
    successes: readonly ReporterCallbackSuccess[]
): void {
    if (event.kind !== 'runner-error') {
        return;
    }

    for (const success of successes) {
        if (hasTerminalReporter(success.reporter)) {
            recordRunnerErrorDelivery(event.error);
        }
    }
}

function recordDeliveredRunnerErrorResult(
    result: RunResult,
    successes: readonly ReporterCallbackSuccess[]
): void {
    if (result.runnerErrors.length === 0) {
        return;
    }

    for (const success of successes) {
        if (hasTerminalReporter(success.reporter)) {
            for (const error of result.runnerErrors) {
                recordRunnerErrorDelivery(error);
            }
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

function createReporterTimeout(
    dependencies: ReporterDispatcherDependencies,
    reporter: Reporter
): ReporterTimeout {
    const { promise, reject } = Promise.withResolvers<never>();
    const timeout = dependencies.wallClock.setTimeout(function rejectTimedOutCallback() {
        reject(timeoutError(reporter));
    }, callbackTimeoutMs);

    return {
        cancel() {
            dependencies.wallClock.clearTimeout(timeout);
        },
        promise
    };
}

function isObject(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function isOutputLineKind(value: unknown): value is OutputLineIntent['kind'] {
    return value === 'stdout-line' || value === 'stderr-line';
}

function isOutputLineRole(value: unknown): value is OutputLineIntent['role'] {
    return value === 'primary' || value === 'supplemental';
}

function isOutputLineIntent(value: unknown): value is OutputLineIntent {
    return isObject(value) &&
        isOutputLineKind(value.kind) &&
        isOutputLineRole(value.role) &&
        typeof value.text === 'string' &&
        Object.hasOwn(value, 'annotation');
}

function normalizeReporterOutput(output: unknown): ReporterOutput {
    if (output === undefined) {
        return [];
    }

    if (Array.isArray(output) && output.every(isOutputLineIntent)) {
        return output;
    }

    throw new Error('Reporter returned invalid managed output.');
}

async function awaitReporterCallback(
    dependencies: ReporterDispatcherDependencies,
    reporter: Reporter,
    callback: ReporterCallback
): Promise<ReporterCallbackResult> {
    const reporterTimeout = createReporterTimeout(dependencies, reporter);
    try {
        const output = await Promise.race([ callback(), reporterTimeout.promise ]);

        return { kind: 'success', output: normalizeReporterOutput(output), reporter };
    } catch (error: unknown) {
        return { error: formatReporterError(reporter, error), kind: 'failure', reporter };
    } finally {
        reporterTimeout.cancel();
    }
}

async function awaitReporterDispose(
    dependencies: ReporterDispatcherDependencies,
    reporter: Reporter,
    dispose: () => Promise<void> | void
): Promise<ReporterCallbackFailure | null> {
    const reporterTimeout = createReporterTimeout(dependencies, reporter);
    try {
        await Promise.race([ dispose(), reporterTimeout.promise ]);

        return null;
    } catch (error: unknown) {
        return { error: formatReporterError(reporter, error), kind: 'failure', reporter };
    } finally {
        reporterTimeout.cancel();
    }
}

function outputIntentStream(intent: OutputLineIntent): 'stderr' | 'stdout' {
    return intent.kind === 'stderr-line' ? 'stderr' : 'stdout';
}

function expectedSinkKind(intent: OutputLineIntent): string {
    return `${outputIntentStream(intent)}-managed-${intent.role}`;
}

function reporterDeclaresOutputIntent(reporter: Reporter, intent: OutputLineIntent): boolean {
    return reporter.sinks.some(function sinkMatchesIntent(sink) {
        return sink.kind === expectedSinkKind(intent);
    });
}

function validateRenderedLine(line: string): void {
    if (line.includes('\n') || line.includes('\r')) {
        throw new Error('Managed output renderer returned a line containing a newline.');
    }
}

function outputWriterForIntent(
    dependencies: ReporterDispatcherDependencies,
    intent: OutputLineIntent
): OutputLineWriter {
    return outputIntentStream(intent) === 'stdout' ? dependencies.stdout : dependencies.stderr;
}

function reporterFailures(results: readonly ReporterCallbackResult[]): readonly ReporterCallbackFailure[] {
    return results.flatMap(function collectFailure(result) {
        return result.kind === 'failure' ? [ result ] : [];
    });
}

function reporterSuccesses(results: readonly ReporterCallbackResult[]): readonly ReporterCallbackSuccess[] {
    return results.flatMap(function collectSuccess(result) {
        return result.kind === 'success' ? [ result ] : [];
    });
}

function assertReporterDeclaresOutputIntent(reporter: Reporter, intent: OutputLineIntent): void {
    if (!reporterDeclaresOutputIntent(reporter, intent)) {
        throw new Error(`Reporter returned undeclared managed ${outputIntentStream(intent)} output.`);
    }
}

function writeReporterOutput(
    dependencies: ReporterDispatcherDependencies,
    reporter: Reporter,
    intent: OutputLineIntent,
    outputRenderer: OutputRenderer
): ReporterCallbackFailure | null {
    try {
        assertReporterDeclaresOutputIntent(reporter, intent);
        const line = outputRenderer.render(intent);

        validateRenderedLine(line);
        outputWriterForIntent(dependencies, intent).writeLine(line);

        return null;
    } catch (error: unknown) {
        return { error: formatReporterError(reporter, error), kind: 'failure', reporter };
    }
}

function writeReporterOutputs(
    dependencies: ReporterDispatcherDependencies,
    outputs: readonly ReporterCallbackSuccess[],
    outputRenderer: OutputRenderer
): readonly ReporterCallbackFailure[] {
    const failures: ReporterCallbackFailure[] = [];

    for (const output of outputs) {
        for (const intent of output.output) {
            const failure = writeReporterOutput(dependencies, output.reporter, intent, outputRenderer);

            if (failure !== null) {
                failures.push(failure);
            }
        }
    }

    return failures;
}

async function reportEventToReporter(
    dependencies: ReporterDispatcherDependencies,
    reporter: RealTimeReporterInDispatch,
    event: ReporterEvent
): Promise<ReporterCallbackResult> {
    return await awaitReporterCallback(
        dependencies,
        reporter,
        function sendReporterEvent(): ReturnType<ReporterCallback> {
            return reporter.onEvent(event);
        }
    );
}

async function reportRunnerErrorToOtherReporters(
    context: ReporterDispatchContext,
    failedReporter: Reporter,
    error: RunnerError
): Promise<readonly RunnerError[]> {
    const event: ReporterEvent = { error, kind: 'runner-error' };
    const failures = await Promise.all(
        context.reporters.map(async function reportRunnerError(reporter): Promise<ReporterCallbackResult | null> {
            if (reporter.kind !== 'real-time' || reporter === failedReporter) {
                return null;
            }

            return reportEventToReporter(context.dependencies, reporter, event);
        })
    );

    const results = failures.flatMap(function collectResult(result) {
        return result === null ? [] : [ result ];
    });
    const successes = reporterSuccesses(results);
    recordDeliveredRunnerErrorEvent(event, successes);
    const outputFailures = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer
    );

    return [
        ...reporterFailures(results).map(function toError(failure) {
            return failure.error;
        }),
        ...outputFailures.map(function toError(failure) {
            return failure.error;
        })
    ];
}

async function collectReporterErrorsWithNotifications(
    context: ReporterDispatchContext,
    reporterErrors: readonly ReporterCallbackFailure[]
): Promise<readonly RunnerError[]> {
    const notificationErrors = await Promise.all(
        reporterErrors.map(async function reportError(failure) {
            return reportRunnerErrorToOtherReporters(context, failure.reporter, failure.error);
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
    context: ReporterDispatchContext,
    event: ReporterEvent
): Promise<readonly RunnerError[]> {
    const results = await Promise.all(
        context.reporters.map(async function reportRealTimeEvent(reporter): Promise<ReporterCallbackResult | null> {
            if (reporter.kind !== 'real-time') {
                return null;
            }

            return reportEventToReporter(context.dependencies, reporter, event);
        })
    );

    const callbackResults = results.flatMap(function collectResult(result) {
        return result === null ? [] : [ result ];
    });
    const successes = reporterSuccesses(callbackResults);
    recordDeliveredRunnerErrorEvent(event, successes);
    const outputErrors = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer
    );
    const reporterErrors = [ ...reporterFailures(callbackResults), ...outputErrors ];

    if (event.kind === 'runner-error') {
        return reporterErrors.map(function toError(failure) {
            return failure.error;
        });
    }

    return collectReporterErrorsWithNotifications(context, reporterErrors);
}

async function reportResult(
    context: ReporterDispatchContext,
    result: RunResult
): Promise<readonly RunnerError[]> {
    const results = await Promise.all(context.reporters.map(async function reportFinalResult(
        reporter
    ): Promise<ReporterCallbackResult | null> {
        if (reporter.kind === 'final-result') {
            return await awaitReporterCallback(
                context.dependencies,
                reporter,
                function reportResultToFinalReporter(): ReturnType<ReporterCallback> {
                    return reporter.onResult(result);
                }
            );
        }

        if (reporter.onFinish === null) {
            return null;
        }

        const { onFinish } = reporter;
        return await awaitReporterCallback(
            context.dependencies,
            reporter,
            function reportResultToRealTimeReporter(): ReturnType<ReporterCallback> {
                return onFinish(result);
            }
        );
    }));

    const callbackResults = results.flatMap(function collectResult(callbackResult) {
        return callbackResult === null ? [] : [ callbackResult ];
    });
    const successes = reporterSuccesses(callbackResults);
    recordDeliveredRunnerErrorResult(result, successes);
    const outputErrors = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer
    );
    const reporterErrors = [ ...reporterFailures(callbackResults), ...outputErrors ];

    return collectReporterErrorsWithNotifications(context, reporterErrors);
}

async function disposeReporters(
    dependencies: ReporterDispatcherDependencies,
    reporters: readonly Reporter[]
): Promise<readonly RunnerError[]> {
    const failures = await Promise.all(reporters.map(async function disposeReporter(
        reporter
    ): Promise<ReporterCallbackFailure | null> {
        if (reporter.dispose === null) {
            return null;
        }

        return await awaitReporterDispose(dependencies, reporter, reporter.dispose);
    }));

    return failures.flatMap(function collectFailure(failure) {
        return failure === null ? [] : [ failure.error ];
    });
}

function createReporterDispatchContext(
    dependencies: ReporterDispatcherDependencies,
    reporters: readonly Reporter[],
    outputRenderer: OutputRenderer
): ReporterDispatchContext {
    return {
        dependencies,
        outputRenderer,
        reporters
    };
}

export function createReporterDispatcher(dependencies: ReporterDispatcherDependencies): ReporterDispatcher {
    return {
        async disposeReporters(reporters) {
            return await disposeReporters(dependencies, reporters);
        },
        async reportEvent(reporters, event, outputRenderer) {
            return await reportEvent(createReporterDispatchContext(dependencies, reporters, outputRenderer), event);
        },
        async reportResult(reporters, result, outputRenderer) {
            return await reportResult(createReporterDispatchContext(dependencies, reporters, outputRenderer), result);
        },
        async trackRunnerErrorDelivery(work) {
            const deliveredRunnerErrors = new Set<RunnerError>();
            const deliveryStore: RunnerErrorDeliveryStore = {
                deliveredRunnerErrors() {
                    return Array.from(deliveredRunnerErrors);
                },
                recordDeliveredRunnerError(error) {
                    deliveredRunnerErrors.add(error);
                }
            };
            const result = await runnerErrorDeliveryStorage.run(deliveryStore, work);

            return {
                deliveredRunnerErrors: deliveryStore.deliveredRunnerErrors(),
                result
            };
        }
    };
}
