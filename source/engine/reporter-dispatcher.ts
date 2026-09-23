import type { OverkillClock } from '../clock/overkill-clock.ts';
import {
    createReporterDisposal as createReporterDisposalFromCallback,
    type ReporterDisposal as CoreReporterDisposal
} from './reporter-disposal.ts';
import {
    recordRunnerErrorDelivery,
    recordUndeliveredRunnerError,
    trackRunnerErrorDelivery
} from './reporter-error-delivery-tracking.ts';
import {
    normalizeReporterOutput,
    type ReporterCallbackFailure,
    type ReporterCallbackSuccess,
    writeReporterOutputs
} from './reporter-managed-output.ts';
import type {
    DefinedOutputRenderer,
    OutputLineWriter,
    OutputRenderer
} from './reporter-output.ts';
import {
    runWithReporterOutputScope,
    type ReporterConsoleMethod
} from './reporter-output-scope.ts';
import { validateReporterSinks, type DefinedReporter, type Reporter, type ReporterEvent } from './reporter.ts';
import { createReportingContext, type ReportingContext } from './reporting-context.ts';
import type { RunResult, RunnerError } from './run-result.ts';

type RealTimeReporterInDispatch = Extract<Reporter, { readonly kind: 'real-time'; }>;

export type ReporterDispatcher = {
    readonly createDelivery: (
        reporters: readonly DefinedReporter[],
        outputRenderer: DefinedOutputRenderer
    ) => Promise<ReporterDelivery>;
    readonly trackRunnerErrorDelivery: <Result>(
        work: () => Promise<Result>
    ) => Promise<{
        readonly deliveredRunnerErrors: readonly RunnerError[];
        readonly result: Result;
        readonly undeliveredRunnerErrors: readonly RunnerError[];
    }>;
};

export type ReporterDelivery = {
    readonly disposeReporters: () => Promise<readonly RunnerError[]>;
    readonly reportEvent: (event: ReporterEvent) => Promise<readonly RunnerError[]>;
    readonly reportResult: (result: RunResult) => Promise<readonly RunnerError[]>;
};

export type ReporterDispatcherDependencies = {
    readonly stderr: OutputLineWriter;
    readonly stdout: OutputLineWriter;
    readonly wallClock: OverkillClock;
};

type ReporterDispatchContext = {
    readonly dependencies: ReporterDispatcherDependencies;
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

type ReporterCallbackResult = ReporterCallbackFailure | ReporterCallbackSuccess;

type ReporterTimeout = {
    readonly cancel: () => void;
    readonly promise: Promise<never>;
};

type ReporterCallback = () => unknown;

type RuntimeReporterCollector = {
    readonly addReporter: (reporter: Reporter) => void;
    readonly reporters: () => readonly Reporter[];
};

const callbackTimeoutMs = 100;

export type ReporterDisposal = CoreReporterDisposal;

export const createReporterDisposal: typeof createReporterDisposalFromCallback = createReporterDisposalFromCallback;

function hasTerminalSink(sink: Reporter['sinks'][number]): boolean {
    return sink.kind.startsWith('stdout') || sink.kind.startsWith('stderr');
}

function hasTerminalReporter(reporter: Reporter): boolean {
    return reporter.sinks.some(hasTerminalSink);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function projectRootFromRunFacts(facts: unknown): string | null {
    if (!isRecord(facts)) {
        return null;
    }

    const { environment } = facts;

    if (!isRecord(environment) || typeof environment.projectRoot !== 'string') {
        return null;
    }

    return environment.projectRoot.trim().length === 0 ? null : environment.projectRoot;
}

function recordDeliveredRunnerErrorEvent(
    event: ReporterEvent,
    successes: readonly ReporterCallbackSuccess[],
    outputFailures: readonly ReporterCallbackFailure[]
): void {
    if (event.kind !== 'runner-error') {
        return;
    }

    const failedOutputReporters = new Set(
        outputFailures.map(function toReporter(failure) {
            return failure.reporter;
        })
    );
    const delivered = successes.some(function deliveredToTerminalReporter(success) {
        return hasTerminalReporter(success.reporter) && !failedOutputReporters.has(success.reporter);
    });

    if (!delivered) {
        recordUndeliveredRunnerError(event.error);
        return;
    }

    for (const success of successes) {
        if (hasTerminalReporter(success.reporter) && !failedOutputReporters.has(success.reporter)) {
            recordRunnerErrorDelivery(event.error);
        }
    }
}

function formatReporterError(reporter: Reporter, cause: unknown): RunnerError {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return {
        attributedTo: null,
        attributedToWork: null,
        cause,
        diagnostics: [ { label: 'reporter', value: reporter.name } ],
        message: `${reporter.name}: ${reason}`,
        subtype: 'reporter'
    };
}

function rawConsoleMethods(reporter: Reporter): readonly ReporterConsoleMethod[] {
    return reporter.sinks.flatMap(function toConsoleMethods(sink): readonly ReporterConsoleMethod[] {
        if (sink.kind === 'stdout-raw') {
            return [ 'debug', 'info', 'log' ];
        }
        if (sink.kind === 'stderr-raw') {
            return [ 'error', 'warn' ];
        }

        return [];
    });
}

function reporterConsoleViolationMessage(method: ReporterConsoleMethod): string {
    return `Reporter used undeclared console.${method} output.`;
}

function firstScopeViolation(violations: readonly string[]): string | null {
    return violations[0] ?? null;
}

async function scopedReporterCallbackOutput(
    reporter: Reporter,
    reporterTimeout: ReporterTimeout,
    callback: ReporterCallback
): Promise<unknown> {
    const scoped = await runWithReporterOutputScope(
        rawConsoleMethods(reporter),
        reporterConsoleViolationMessage,
        async function runReporterCallback() {
            return await Promise.race([ callback(), reporterTimeout.promise ]);
        }
    );
    const violation = firstScopeViolation(scoped.violations);

    if (violation !== null) {
        throw new Error(violation);
    }

    return scoped.result;
}

async function scopedReporterDisposal(
    reporter: Reporter,
    reporterTimeout: ReporterTimeout,
    dispose: () => Promise<void> | void
): Promise<void> {
    const scoped = await runWithReporterOutputScope(
        rawConsoleMethods(reporter),
        reporterConsoleViolationMessage,
        async function disposeReporter() {
            await Promise.race([ dispose(), reporterTimeout.promise ]);
        }
    );
    const violation = firstScopeViolation(scoped.violations);

    if (violation !== null) {
        throw new Error(violation);
    }
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

async function awaitReporterCallback(
    dependencies: ReporterDispatcherDependencies,
    reporter: Reporter,
    callback: ReporterCallback
): Promise<ReporterCallbackResult> {
    const reporterTimeout = createReporterTimeout(dependencies, reporter);
    try {
        const output = await scopedReporterCallbackOutput(reporter, reporterTimeout, callback);

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
        await scopedReporterDisposal(reporter, reporterTimeout, dispose);

        return null;
    } catch (error: unknown) {
        return { error: formatReporterError(reporter, error), kind: 'failure', reporter };
    } finally {
        reporterTimeout.cancel();
    }
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
    const outputFailures = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer,
        formatReporterError
    );
    recordDeliveredRunnerErrorEvent(event, successes, outputFailures);

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
    const outputErrors = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer,
        formatReporterError
    );
    recordDeliveredRunnerErrorEvent(event, successes, outputErrors);
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
    const outputErrors = writeReporterOutputs(
        context.dependencies,
        successes,
        context.outputRenderer,
        formatReporterError
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

function createRuntimeReporterCollector(): RuntimeReporterCollector {
    const reporters: Reporter[] = [];

    return {
        addReporter(reporter) {
            reporters.push(reporter);
        },
        reporters() {
            return reporters;
        }
    };
}

function collectRuntimeReporters(
    collector: RuntimeReporterCollector,
    reporterDefinitions: readonly DefinedReporter[],
    reportingContext: ReportingContext
): void {
    for (const reporterDefinition of reporterDefinitions) {
        collector.addReporter(reporterDefinition(reportingContext));
    }
}

async function throwWithReporterCleanupErrors(
    error: unknown,
    dependencies: ReporterDispatcherDependencies,
    reporters: readonly Reporter[]
): Promise<never> {
    const disposeErrors = await disposeReporters(dependencies, reporters);

    if (disposeErrors.length > 0) {
        throw new AggregateError(
            [ error, ...disposeErrors ],
            'Reporter delivery creation failed and reporter cleanup failed.',
            { cause: error }
        );
    }

    throw error;
}

async function createReporterDelivery(
    dependencies: ReporterDispatcherDependencies,
    reporterDefinitions: readonly DefinedReporter[],
    outputRendererDefinition: DefinedOutputRenderer
): Promise<ReporterDelivery> {
    const state = { projectRoot: null as string | null };
    const reportingContext = createReportingContext(state);
    const reporterCollector = createRuntimeReporterCollector();

    try {
        collectRuntimeReporters(reporterCollector, reporterDefinitions, reportingContext);
        validateReporterSinks(reporterCollector.reporters());
    } catch (error: unknown) {
        return await throwWithReporterCleanupErrors(error, dependencies, reporterCollector.reporters());
    }

    const context = createReporterDispatchContext(
        dependencies,
        reporterCollector.reporters(),
        outputRendererDefinition(reportingContext)
    );
    let reportersDisposed = false;

    return {
        async disposeReporters() {
            if (reportersDisposed) {
                return [];
            }

            reportersDisposed = true;

            return await disposeReporters(dependencies, context.reporters);
        },
        async reportEvent(event) {
            if (event.kind === 'run-start') {
                state.projectRoot = projectRootFromRunFacts(event.facts);
            }

            return await reportEvent(context, event);
        },
        async reportResult(result) {
            return await reportResult(context, result);
        }
    };
}

export function createReporterDispatcher(dependencies: ReporterDispatcherDependencies): ReporterDispatcher {
    return {
        async createDelivery(reporters, outputRenderer) {
            return await createReporterDelivery(dependencies, reporters, outputRenderer);
        },
        async trackRunnerErrorDelivery(work) {
            return await trackRunnerErrorDelivery(work);
        }
    };
}
