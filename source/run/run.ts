import type { CaseId } from '../engine/identity.ts';
import type { Reporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';

export type RunSelection = {
    readonly kind: 'all' | 'case-id' | 'file' | 'filter' | 'last-failed' | 'name';
    readonly value: string | null;
};

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunExecutionRequest = {
    readonly mode: string;
    readonly workers: number;
};

export type RunSeed = {
    readonly value: bigint | null;
};

export type RunDebugRequest = {
    readonly mode: 'all' | 'off' | 'selected';
    readonly selectors: readonly string[];
};

export type RunRequest = {
    readonly paths: readonly string[];
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly profile: string;
    readonly execution: RunExecutionRequest;
    readonly coverage: boolean;
    readonly capture: 'buffered' | 'live';
    readonly seed: RunSeed;
    readonly order: 'lexical' | 'seeded';
    readonly debug: RunDebugRequest;
    readonly configPath: string | null;
};

export type RunFacts = {
    readonly seed: bigint;
    readonly identities: readonly CaseId[];
    readonly executionStrategy: string;
    readonly capabilityProfile: string;
    readonly baselineUpdateMode: 'apply' | 'bootstrap' | 'diff' | 'none' | 'update';
    readonly loaderConfig: {
        readonly stripMode: 'strip-only' | 'transform';
        readonly sourceMaps: boolean;
    };
    readonly versions: {
        readonly engine: string;
        readonly node: string;
        readonly packages: Readonly<Record<string, string>>;
    };
    readonly debug: RunFactsDebug;
};

export type RunFactsDebug = {
    readonly mode: 'all' | 'off' | 'selected';
    readonly caseIds: readonly CaseId[];
};

export type ResolvedRun = {
    readonly request: RunRequest;
    readonly facts: RunFacts;
    readonly testPlan: TestPlan;
    readonly reporters: readonly Reporter[];
};

function acceptRunRequestForFutureResolution(request: RunRequest): RunRequest {
    return request;
}

export async function resolveRun(request: RunRequest): Promise<ResolvedRun> {
    acceptRunRequestForFutureResolution(request);

    throw new Error('resolveRun() is not implemented yet.');
}

export async function run(request: RunRequest): Promise<never> {
    acceptRunRequestForFutureResolution(request);

    throw new Error('run() is not implemented yet.');
}
