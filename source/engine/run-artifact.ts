import type { AttemptId, CaseId, RuntimeId, WorkloadId } from './identity.ts';

export type RunArtifactScope = {
    readonly activeCases: readonly CaseId[];
    readonly case: CaseId;
    readonly confidence: 'active-case' | 'concurrent-active';
    readonly kind: 'case';
} | {
    readonly kind: 'run';
};

type RunArtifactBaseId = {
    readonly runtimes: readonly RuntimeId[];
    readonly sequence: number;
    readonly subtype: 'attachment' | 'coverage' | 'hedged-conflict' | 'log-capture';
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
    readonly stream: 'stderr' | 'stdout';
    readonly text: string;
    readonly truncated: boolean;
};

export type CapturedOutputArtifact = {
    readonly id: RunArtifactId & { readonly subtype: 'log-capture'; };
    readonly payload: CapturedOutputArtifactPayload;
    readonly source: 'boundary-captured' | 'native';
};
