import type { CaseId } from './identity.ts';
import type { ResolvedMetadata } from './metadata.ts';
import type { OptionalReporterOutput, OutputIntentRole } from './reporter-output.ts';
import type { RunResult, RunnerError, TestOutcome, TestVerdict } from './run-result.ts';

const reporterBrand = Symbol.for('@overkill-dev/engine/reporter');

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
type NonManagedSinkDeclaration = Exclude<SinkDeclaration, ManagedStandardOutputSinkDeclaration>;
type ManagedSinkAt1 = readonly [ManagedStandardOutputSinkDeclaration, ...SinkDeclaration[]];
type ManagedSinkAt2 = readonly [
    NonManagedSinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    ...SinkDeclaration[]
];
type ManagedSinkAt3 = readonly [
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    ...SinkDeclaration[]
];
type ManagedSinkAt4 = readonly [
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    ...SinkDeclaration[]
];
type ManagedSinkAt5 = readonly [
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    ...SinkDeclaration[]
];
type ManagedSinkAt6 = readonly [
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    NonManagedSinkDeclaration,
    ManagedStandardOutputSinkDeclaration,
    ...SinkDeclaration[]
];
type ManagedSinkAt1To3 = ManagedSinkAt1 | ManagedSinkAt2 | ManagedSinkAt3;
type ManagedSinkAt4To6 = ManagedSinkAt4 | ManagedSinkAt5 | ManagedSinkAt6;
type ManagedStandardOutputSinkTuple = ManagedSinkAt1To3 | ManagedSinkAt4To6;

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
        readonly metadata: ResolvedMetadata;
        readonly title: string;
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
    readonly outcome: TestOutcome | null;
    readonly verdict: TestVerdict;
    readonly wallTimeMs: number;
};

type RunReporterEvent = RunEndReporterEvent | RunnerErrorReporterEvent | RunStartReporterEvent;
type SuiteReporterEvent = SuiteEndReporterEvent | SuiteStartReporterEvent;
type TestReporterEvent = TestEndReporterEvent | TestProgressReporterEvent | TestStartReporterEvent;

export type ReporterEvent = RunReporterEvent | SuiteReporterEvent | TestReporterEvent;

type ManagedStandardOutputSinkPresence<
    FirstSink extends SinkDeclaration,
    RemainingSinks extends readonly SinkDeclaration[]
> = FirstSink extends ManagedStandardOutputSinkDeclaration ? true
    : TupleIncludesManagedStandardOutputSink<RemainingSinks>;

type FirstDeclaredSink<Sinks extends readonly SinkDeclaration[]> = Sinks extends readonly [
    infer FirstSink extends SinkDeclaration,
    ...SinkDeclaration[]
] ? FirstSink
    : never;

type RemainingDeclaredSinks<Sinks extends readonly SinkDeclaration[]> = Sinks extends readonly [
    SinkDeclaration,
    ...infer RemainingSinks extends readonly SinkDeclaration[]
] ? RemainingSinks
    : never;

type TupleIncludesManagedStandardOutputSink<Sinks extends readonly SinkDeclaration[]> = Sinks extends readonly []
    ? false
    : ManagedStandardOutputSinkPresence<FirstDeclaredSink<Sinks>, RemainingDeclaredSinks<Sinks>>;

type HasManagedStandardOutputSink<Sinks extends readonly SinkDeclaration[]> = number extends Sinks['length'] ? false
    : TupleIncludesManagedStandardOutputSink<Sinks>;

type BaseRealTimeReporter<Sinks extends readonly SinkDeclaration[]> = {
    readonly dispose: (() => Promise<void> | void) | null;
    readonly kind: 'real-time';
    readonly name: string;
    readonly sinks: Sinks;
};

type ManagedOutputEventCallback = (
    event: ReporterEvent
) => OptionalReporterOutput | Promise<OptionalReporterOutput>;

type ManagedOutputFinishCallback = (
    result: RunResult
) => OptionalReporterOutput | Promise<OptionalReporterOutput>;

type RealTimeReporterWithOutput<Sinks extends readonly SinkDeclaration[]> = BaseRealTimeReporter<Sinks> & {
    readonly onEvent: ManagedOutputEventCallback;
    readonly onFinish: ManagedOutputFinishCallback | null;
};

type RealTimeReporterWithoutOutput<Sinks extends readonly SinkDeclaration[]> = BaseRealTimeReporter<Sinks> & {
    readonly onEvent: (event: ReporterEvent) => Promise<void> | void;
    readonly onFinish: ((result: RunResult) => Promise<void> | void) | null;
};

type BaseFinalResultReporter<Sinks extends readonly SinkDeclaration[]> = {
    readonly dispose: (() => Promise<void> | void) | null;
    readonly kind: 'final-result';
    readonly name: string;
    readonly sinks: Sinks;
};

type ManagedOutputResultCallback = (
    result: RunResult
) => OptionalReporterOutput | Promise<OptionalReporterOutput>;

type FinalResultReporterWithOutput<Sinks extends readonly SinkDeclaration[]> = BaseFinalResultReporter<Sinks> & {
    readonly onResult: ManagedOutputResultCallback;
};

type FinalResultReporterWithoutOutput<Sinks extends readonly SinkDeclaration[]> = BaseFinalResultReporter<Sinks> & {
    readonly onResult: (result: RunResult) => Promise<void> | void;
};

export type RealTimeReporter<Sinks extends readonly SinkDeclaration[] = readonly SinkDeclaration[]> =
    HasManagedStandardOutputSink<Sinks> extends true ? RealTimeReporterWithOutput<Sinks>
        : RealTimeReporterWithoutOutput<Sinks>;

export type FinalResultReporter<Sinks extends readonly SinkDeclaration[] = readonly SinkDeclaration[]> =
    HasManagedStandardOutputSink<Sinks> extends true ? FinalResultReporterWithOutput<Sinks>
        : FinalResultReporterWithoutOutput<Sinks>;

type OutputFinalReporter = FinalResultReporterWithOutput<ManagedStandardOutputSinkTuple>;
type OutputRealTimeReporter = RealTimeReporterWithOutput<ManagedStandardOutputSinkTuple>;
type SideEffectFinalReporter = FinalResultReporterWithoutOutput<readonly SinkDeclaration[]>;
type SideEffectRealTimeReporter = RealTimeReporterWithoutOutput<readonly SinkDeclaration[]>;
type OutputReporter = OutputFinalReporter | OutputRealTimeReporter;
type SideEffectReporter = SideEffectFinalReporter | SideEffectRealTimeReporter;

export type Reporter = OutputReporter | SideEffectReporter;
export type DefinedReporter<ReporterValue extends Reporter = Reporter> = ReporterValue & {
    readonly [reporterBrand]: true;
};

export function defineReporter<ReporterValue extends Reporter>(
    reporter: ReporterValue
): DefinedReporter<ReporterValue> {
    return Object.assign(reporter, { [reporterBrand]: true as const });
}

export function isReporter(value: unknown): value is DefinedReporter {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, reporterBrand);
}

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
