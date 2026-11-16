import type {
    OutputLineIntent,
    OutputLineWriter,
    OutputRenderer,
    ReporterOutput
} from './reporter-output.ts';
import {
    runWithReporterOutputScopeNow,
    type ReporterConsoleMethod
} from './reporter-output-scope.ts';
import type { Reporter } from './reporter.ts';
import type { RunnerError } from './run-result.ts';

export type ReporterCallbackFailure = {
    readonly error: RunnerError;
    readonly kind: 'failure';
    readonly reporter: Reporter;
};

export type ReporterCallbackSuccess = {
    readonly kind: 'success';
    readonly output: ReporterOutput;
    readonly reporter: Reporter;
};

type ManagedOutputDependencies = {
    readonly stderr: OutputLineWriter;
    readonly stdout: OutputLineWriter;
};

type ReporterErrorFormatter = (reporter: Reporter, cause: unknown) => RunnerError;

type WriteReporterOutputInput = {
    readonly dependencies: ManagedOutputDependencies;
    readonly formatReporterError: ReporterErrorFormatter;
    readonly intent: OutputLineIntent;
    readonly outputRenderer: OutputRenderer;
    readonly reporter: Reporter;
};

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

export function normalizeReporterOutput(output: unknown): ReporterOutput {
    if (output === undefined) {
        return [];
    }

    if (Array.isArray(output) && output.every(isOutputLineIntent)) {
        return output;
    }

    throw new Error('Reporter returned invalid managed output.');
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
    dependencies: ManagedOutputDependencies,
    intent: OutputLineIntent
): OutputLineWriter {
    return outputIntentStream(intent) === 'stdout' ? dependencies.stdout : dependencies.stderr;
}

function consoleMethodsForIntent(intent: OutputLineIntent): readonly ReporterConsoleMethod[] {
    return outputIntentStream(intent) === 'stdout'
        ? [ 'debug', 'info', 'log' ]
        : [ 'error', 'warn' ];
}

function managedOutputConsoleViolationMessage(intent: OutputLineIntent, method: ReporterConsoleMethod): string {
    return `Managed ${outputIntentStream(intent)} output used console.${method}.`;
}

function assertReporterDeclaresOutputIntent(reporter: Reporter, intent: OutputLineIntent): void {
    if (!reporterDeclaresOutputIntent(reporter, intent)) {
        throw new Error(`Reporter returned undeclared managed ${outputIntentStream(intent)} output.`);
    }
}

function writeScopedManagedOutput(input: WriteReporterOutputInput): void {
    assertReporterDeclaresOutputIntent(input.reporter, input.intent);
    const rendered = runWithReporterOutputScopeNow(
        consoleMethodsForIntent(input.intent),
        function formatManagedOutputConsoleViolation(method) {
            return managedOutputConsoleViolationMessage(input.intent, method);
        },
        function writeManagedOutput() {
            const line = input.outputRenderer.render(input.intent);

            validateRenderedLine(line);
            outputWriterForIntent(input.dependencies, input.intent).writeLine(line);

            return line;
        }
    );
    const violation = rendered.violations[0] ?? null;

    if (violation !== null) {
        throw new Error(violation);
    }
}

function writeReporterOutput(input: WriteReporterOutputInput): ReporterCallbackFailure | null {
    try {
        writeScopedManagedOutput(input);

        return null;
    } catch (error: unknown) {
        return {
            error: input.formatReporterError(input.reporter, error),
            kind: 'failure',
            reporter: input.reporter
        };
    }
}

export function writeReporterOutputs(
    dependencies: ManagedOutputDependencies,
    outputs: readonly ReporterCallbackSuccess[],
    outputRenderer: OutputRenderer,
    formatReporterError: ReporterErrorFormatter
): readonly ReporterCallbackFailure[] {
    const failures: ReporterCallbackFailure[] = [];

    for (const output of outputs) {
        for (const intent of output.output) {
            const failure = writeReporterOutput({
                dependencies,
                formatReporterError,
                intent,
                outputRenderer,
                reporter: output.reporter
            });

            if (failure !== null) {
                failures.push(failure);
            }
        }
    }

    return failures;
}
