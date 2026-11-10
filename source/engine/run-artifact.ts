import type { ReadonlyDeep, JsonValue, Except } from 'type-fest';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { TestDebugPayload } from './test-debug.ts';
import type { ExecuteProcessBudgets, ProcessUsageSnapshot } from './process-usage.ts';
import {
    workIdentityKey,
    type AttemptId,
    type CaseId,
    type RuntimeId,
    type WorkId,
    type WorkloadId
} from './identity.ts';

export type RunArtifactScope = {
    readonly activeCases: readonly CaseId[];
    readonly case: CaseId;
    readonly confidence: 'active-case' | 'concurrent-active';
    readonly kind: 'case';
} | {
    readonly kind: 'run';
};

type RunArtifactBaseId = {
    readonly familyVariant: WorkId['familyVariant'];
    readonly runtimes: readonly RuntimeId[];
    readonly sequence: number;
    readonly subtype: RunArtifactSubtype;
    readonly workload: WorkloadId | null;
};

type CaseArtifactId = RunArtifactBaseId & {
    readonly attempt: AttemptId;
    readonly scope: Extract<RunArtifactScope, { readonly kind: 'case'; }>;
};

type RunScopedArtifactId = RunArtifactBaseId & {
    readonly attempt: null;
    readonly scope: { readonly kind: 'run'; };
};

export type RunArtifactId = CaseArtifactId | RunScopedArtifactId;

export type CapturedOutputArtifactPayload = {
    readonly byteLength: number;
    readonly capturedAtMicroseconds: number;
    readonly kind: 'captured-output';
    readonly capture: 'automatic';
    readonly completeness: 'best-effort';
    readonly stream: 'stderr' | 'stdout';
    readonly text: string;
    readonly truncated: boolean;
};

export type CapturedOutputArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'log-capture' | 'witness'; };
    readonly payload: CapturedOutputArtifactPayload;
    readonly source: 'boundary-captured' | 'native';
};

export type AdapterArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'adapter'; };
    readonly payload: { readonly kind: 'adapter'; readonly adapter: string; readonly facts: ReadonlyDeep<JsonValue>; };
    readonly source: 'native';
};

export const runArtifactSubtypes = [
    'debug',
    'adapter',
    'attachment',
    'coverage',
    'hedged-conflict',
    'log-capture',
    'witness',
    'worker-crash',
    'process-exhaustion'
] as const;
type RunArtifactSubtype = (typeof runArtifactSubtypes)[number];
export const boundaryUsageSampleLimit = 2;

export type ActiveBoundaryWork = { readonly work: WorkId; readonly attempt: AttemptId; };
export type BoundaryMetadata = {
    readonly timestamp: string;
    readonly workerId: string | null;
    readonly nodeVersion: string | null;
    readonly source: 'boundary-captured' | 'native';
};
type BoundaryEvidence = {
    readonly timestamp: string;
    readonly workerId: string | null;
    readonly activeWork: readonly ActiveBoundaryWork[];
    readonly capture: 'automatic';
    readonly completeness: 'best-effort';
};
export type BoundaryFailure = {
    readonly kind: 'process-exhaustion';
    readonly metric: keyof ExecuteProcessBudgets;
    readonly budget: number;
    readonly observed: number;
    readonly enforcement: 'post-test-diagnostic' | 'sampled' | 'v8-heap-limit';
    readonly processUsageSamplingIntervalMilliseconds: number | null;
    readonly samples: readonly ProcessUsageSnapshot[];
} | {
    readonly kind: 'worker-crash';
    readonly reason: string;
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly coreDumpPath: string | null;
    readonly nativeAddons: readonly string[] | null;
};
type BoundaryArtifact<Failure extends BoundaryFailure> = {
    readonly id: RunArtifactId & { readonly subtype: Failure['kind']; };
    readonly source: BoundaryMetadata['source'];
    readonly payload: BoundaryEvidence & Failure & { readonly nodeVersion: string | null; };
};
export type WorkerCrashArtifact = BoundaryArtifact<Extract<BoundaryFailure, { readonly kind: 'worker-crash'; }>>;
export type ProcessExhaustionArtifact = BoundaryArtifact<
    Extract<BoundaryFailure, { readonly kind: 'process-exhaustion'; }>
>;
export type BoundaryFailureArtifact = ProcessExhaustionArtifact | WorkerCrashArtifact;

function boundaryIdentity(activeWork: readonly ActiveBoundaryWork[], sequence: number): RunArtifactId {
    const [ active ] = activeWork;
    return activeWork.length === 1 && active !== undefined
        ? {
            familyVariant: active.work.familyVariant,
            attempt: active.attempt,
            scope: {
                kind: 'case',
                case: active.work.case,
                activeCases: [ active.work.case ],
                confidence: 'active-case'
            },
            runtimes: active.work.runtimes,
            workload: active.work.workload,
            sequence,
            subtype: 'worker-crash'
        }
        : {
            familyVariant: null,
            attempt: null,
            scope: { kind: 'run' },
            runtimes: [],
            workload: null,
            sequence,
            subtype: 'worker-crash'
        };
}

export function createBoundaryFailureArtifact(
    failure: BoundaryFailure,
    metadata: BoundaryMetadata,
    activeWork: readonly ActiveBoundaryWork[],
    sequence: number
): BoundaryFailureArtifact {
    const id = boundaryIdentity(activeWork, sequence);
    const evidence: BoundaryEvidence & { readonly nodeVersion: string | null; } = {
        timestamp: metadata.timestamp,
        workerId: metadata.workerId,
        nodeVersion: metadata.nodeVersion,
        activeWork,
        capture: 'automatic',
        completeness: 'best-effort'
    };
    return failure.kind === 'worker-crash'
        ? { id: { ...id, subtype: 'worker-crash' }, source: metadata.source, payload: { ...failure, ...evidence } }
        : {
            id: { ...id, subtype: 'process-exhaustion' },
            source: metadata.source,
            payload: { ...failure, ...evidence, samples: failure.samples.slice(-boundaryUsageSampleLimit) }
        };
}

export function artifactsForAttempt<Artifact extends { readonly id: RunArtifactId; }>(
    artifacts: readonly Artifact[],
    work: WorkId,
    attempt: AttemptId
): readonly Artifact[] {
    const key = workIdentityKey(work);
    return artifacts.filter(function belongsToAttempt(artifact) {
        if (artifact.id.scope.kind !== 'case' || artifact.id.attempt?.index !== attempt.index) {
            return false;
        }
        const identity = {
            familyVariant: artifact.id.familyVariant ?? null,
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        };
        return workIdentityKey(identity) === key;
    });
}

export type TestDebugArtifact = {
    readonly id: CaseArtifactId & { readonly subtype: 'debug'; };
    readonly source: 'boundary-captured' | 'native';
    readonly payload: TestDebugPayload;
};
export function artifactIdentityProjection(id: RunArtifactId): Except<RunArtifactId, 'familyVariant'> | RunArtifactId {
    const { familyVariant, ...neutral } = id;
    return familyVariant === null ? neutral : id;
}

export function artifactReferenceKey(reference: unknown): string {
    if (typeof reference === 'object' && reference !== null && Reflect.get(reference, 'familyVariant') === null) {
        const entries = Object.entries(reference).filter(function retainedIdentityField([ key ]) {
            return key !== 'familyVariant';
        });
        return canonicalIdentityJson(Object.fromEntries(entries));
    }
    return canonicalIdentityJson(reference);
}
