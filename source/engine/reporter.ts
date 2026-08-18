import type { CaseId } from './identity.ts';
import type { OptionalReporterOutput, OutputIntentRole } from './reporter-output.ts';
import type { RunResult, RunnerError, TestOutcome } from './run-result.ts';
import type { Metadata } from './test-node.ts';

export type RunFacts = Readonly<Record<string, unknown>>;

export type RawStandardOutputSinkDeclaration = {
    readonly kind: 'stderr-raw' | 'stdout-raw';
};

const managedStandardOutputSinkKinds = [
    'stderr-managed-primary',
    'stderr-managed-supplemental',
    'stdout-managed-primary',
    'stdout-managed-supplemental'
] as const;

type ManagedStandardOutputSinkKind = typeof managedStandardOutputSinkKinds[number];
const managedStandardOutputSinkKindNames: readonly string[] = managedStandardOutputSinkKinds;

export type ManagedStandardOutputSinkDeclaration = {
    readonly kind: ManagedStandardOutputSinkKind;
};

export type FileSinkDeclaration = {
    readonly kind: 'file';
    readonly path: string;
};

export type DirectorySinkDeclaration = {
    readonly kind: 'directory';
    readonly path: string;
};

export type MemorySinkDeclaration = {
    readonly kind: 'memory';
};

export type StreamSinkDeclaration = {
    readonly kind: 'stream';
    readonly provided: WritableStream<unknown>;
};

type FileSystemSinkDeclaration = DirectorySinkDeclaration | FileSinkDeclaration;
type PrivateSinkDeclaration = MemorySinkDeclaration | StreamSinkDeclaration;
export type StandardOutputSinkDeclaration = ManagedStandardOutputSinkDeclaration | RawStandardOutputSinkDeclaration;
type ReporterSinkDeclaration = FileSystemSinkDeclaration | StandardOutputSinkDeclaration;

export type SinkDeclaration = PrivateSinkDeclaration | ReporterSinkDeclaration;

export class ReporterSinkConflictError extends Error {
    public constructor(message: string, options?: Readonly<ErrorOptions>) {
        super(message, options);
        this.name = 'ReporterSinkConflictError';
    }
}

type RunStartReporterEvent = {
    readonly facts: RunFacts;
    readonly kind: 'run-start';
    readonly root: {
        readonly metadata: Metadata;
        readonly name: string;
    };
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
    readonly dispose: (() => Promise<void> | void) | null;
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onEvent: (event: ReporterEvent) => OptionalReporterOutput | Promise<OptionalReporterOutput>;
    readonly onFinish: ((result: RunResult) => OptionalReporterOutput | Promise<OptionalReporterOutput>) | null;
};

export type FinalResultReporter = {
    readonly dispose: (() => Promise<void> | void) | null;
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: readonly SinkDeclaration[];
    readonly onResult: (result: RunResult) => OptionalReporterOutput | Promise<OptionalReporterOutput>;
};

export type Reporter = FinalResultReporter | RealTimeReporter;

type ClaimedSink = {
    readonly mode: 'managed' | 'raw';
    readonly role: OutputIntentRole | null;
};

function pathSinkKey(sink: DirectorySinkDeclaration | FileSinkDeclaration): string {
    return `path:${sink.path}`;
}

function standardOutputStream(sink: StandardOutputSinkDeclaration): 'stderr' | 'stdout' {
    return sink.kind.startsWith('stderr') ? 'stderr' : 'stdout';
}

function isManagedStandardOutputSink(sink: SinkDeclaration): sink is ManagedStandardOutputSinkDeclaration {
    return managedStandardOutputSinkKindNames.includes(sink.kind);
}

function standardOutputRole(sink: ManagedStandardOutputSinkDeclaration): OutputIntentRole {
    if (sink.kind.endsWith('primary')) {
        return 'primary';
    }

    return 'supplemental';
}

function standardOutputSinkConflictMessage(stream: 'stderr' | 'stdout'): string {
    return `Reporter sink conflict: ${stream} is claimed by incompatible reporters.`;
}

function nextClaimedStandardOutputRole(
    existingSink: ClaimedSink | undefined,
    sink: ManagedStandardOutputSinkDeclaration
): OutputIntentRole {
    return existingSink?.role === 'primary' ? 'primary' : standardOutputRole(sink);
}

function claimStandardOutputSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    key: 'stderr' | 'stdout',
    sink: ClaimedSink
): ReadonlyMap<string, ClaimedSink> {
    const updatedSinks = new Map(claimedSinks);

    return updatedSinks.set(key, sink);
}

function validateRawStandardOutputSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: RawStandardOutputSinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    const key = standardOutputStream(sink);

    if (claimedSinks.has(key)) {
        throw new ReporterSinkConflictError(standardOutputSinkConflictMessage(key));
    }

    return claimStandardOutputSink(claimedSinks, key, { mode: 'raw', role: null });
}

function validateManagedStandardOutputSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: ManagedStandardOutputSinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    const key = standardOutputStream(sink);
    const existingSink = claimedSinks.get(key);
    const sinkRole = standardOutputRole(sink);

    if (existingSink?.mode === 'raw' || existingSink?.role === 'primary' && sinkRole === 'primary') {
        throw new ReporterSinkConflictError(standardOutputSinkConflictMessage(key));
    }

    return claimStandardOutputSink(claimedSinks, key, {
        mode: 'managed',
        role: nextClaimedStandardOutputRole(existingSink, sink)
    });
}

function validatePathSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: DirectorySinkDeclaration | FileSinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    const key = pathSinkKey(sink);

    if (claimedSinks.has(key)) {
        throw new ReporterSinkConflictError(
            `Reporter sink conflict: path "${sink.path}" is claimed by multiple reporters.`
        );
    }

    const updatedSinks = new Map(claimedSinks);

    return updatedSinks.set(key, {
        mode: 'raw',
        role: null
    });
}

function validateReporterSink(
    claimedSinks: ReadonlyMap<string, ClaimedSink>,
    sink: SinkDeclaration
): ReadonlyMap<string, ClaimedSink> {
    if (sink.kind === 'stdout-raw' || sink.kind === 'stderr-raw') {
        return validateRawStandardOutputSink(claimedSinks, sink);
    }
    if (isManagedStandardOutputSink(sink)) {
        return validateManagedStandardOutputSink(claimedSinks, sink);
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
