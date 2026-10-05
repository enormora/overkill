import { permissionDeniedRunnerErrorFromThrown, type RunnerError } from '../engine/run-result.ts';
import type { RuntimeId } from '../engine/identity.ts';
import type {
    RunProcessModel,
    RunTestFamily,
    RunWorkerLifecycle,
    WorkId,
    WorkUnitId
} from './run-types.ts';

export type RunResolutionErrorCode = 'invalid-request' | 'no-tests-collected' | 'unsupported-request';

export class RunConfigError extends Error {
    public constructor(message: string, options?: Readonly<ErrorOptions>) {
        super(message, options);
        this.name = 'RunConfigError';
    }
}

export class RunResolutionError extends Error {
    private readonly errorCode: RunResolutionErrorCode;

    public constructor(message: string, options: Readonly<ErrorOptions> | undefined, code: RunResolutionErrorCode) {
        super(message, options);
        this.name = 'RunResolutionError';
        this.errorCode = code;
    }

    public code(): RunResolutionErrorCode {
        return this.errorCode;
    }
}

type ExecutionPlanResourceScope = 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';

export type ExecutionPlanResourceFacts = {
    readonly name: string;
    readonly scope: ExecutionPlanResourceScope;
};

export type RunExecutionPlanConflict = {
    readonly available: number;
    readonly kind: 'worker-capacity';
    readonly lifecycles: readonly [RunWorkerLifecycle, ...readonly RunWorkerLifecycle[]];
    readonly required: number;
} | {
    readonly boundaryKey: string;
    readonly kind: 'resource-projection-required';
    readonly resource: ExecutionPlanResourceFacts;
    readonly work: readonly [WorkId, ...readonly WorkId[]];
} | {
    readonly constraint: string;
    readonly kind: 'worker-lifecycle';
    readonly lifecycles: readonly [RunWorkerLifecycle, ...readonly RunWorkerLifecycle[]];
    readonly units: readonly [WorkUnitId, ...readonly WorkUnitId[]];
} | {
    readonly definitions: readonly [ExecutionPlanResourceFacts, ...readonly ExecutionPlanResourceFacts[]];
    readonly kind: 'resource-definition';
    readonly name: string;
    readonly work: readonly [WorkId, ...readonly WorkId[]];
} | {
    readonly dependency: ExecutionPlanResourceFacts;
    readonly kind: 'resource-dependency-scope';
    readonly resource: ExecutionPlanResourceFacts;
    readonly work: readonly [WorkId, ...readonly WorkId[]];
} | {
    readonly file: string;
    readonly fileSet: string | null;
    readonly kind: 'work-distribution';
    readonly reason: 'missing-file-set' | 'unmatched-file-set';
} | {
    readonly kind: 'process-model';
    readonly processModel: RunProcessModel;
    readonly reason: 'resource-descriptors' | 'test-family';
    readonly testFamily: RunTestFamily;
    readonly work: readonly [WorkId, ...readonly WorkId[]];
} | {
    readonly kind: 'runtime-definition';
    readonly runtime: RuntimeId;
    readonly work: readonly [WorkId, ...readonly WorkId[]];
};

function resourceConflictMessage(conflict: RunExecutionPlanConflict): string | null {
    if (conflict.kind === 'resource-projection-required') {
        return `Resource "${conflict.resource.name}" requires handle projection for ` +
            `${conflict.resource.scope} ownership.`;
    }

    if (conflict.kind === 'resource-dependency-scope') {
        return `Resource "${conflict.resource.name}" with ${conflict.resource.scope} scope cannot depend on ` +
            `resource "${conflict.dependency.name}" with ${conflict.dependency.scope} scope.`;
    }

    if (conflict.kind === 'resource-definition') {
        return `Resource identity "${conflict.name}" has incompatible definitions.`;
    }

    return null;
}

function workerConflictMessage(conflict: RunExecutionPlanConflict): string | null {
    if (conflict.kind === 'worker-lifecycle') {
        return `Hard constraint "${conflict.constraint}" spans incompatible worker lifecycles.`;
    }

    if (conflict.kind === 'worker-capacity') {
        return `Worker-pool execution requires ${conflict.required} lifecycle lanes but only ` +
            `${conflict.available} are available.`;
    }

    if (conflict.kind === 'work-distribution') {
        return conflict.reason === 'missing-file-set'
            ? `Grouped work distribution requires a file set for "${conflict.file}".`
            : `Grouped work distribution has no group for file set "${conflict.fileSet}" ` +
                `selected by "${conflict.file}".`;
    }

    return null;
}

function identityConflictMessage(conflict: RunExecutionPlanConflict): string | null {
    if (conflict.kind === 'runtime-definition') {
        return `Runtime identity "${conflict.runtime.name}" has incompatible definitions.`;
    }

    if (conflict.kind === 'process-model') {
        return `Process model "${conflict.processModel}" is incompatible with the selected ` +
            `${conflict.testFamily} work.`;
    }

    return null;
}

function conflictMessage(conflict: RunExecutionPlanConflict): string {
    return resourceConflictMessage(conflict) ??
        workerConflictMessage(conflict) ??
        identityConflictMessage(conflict) ??
        'Execution plan has an unknown incompatibility.';
}

export class RunExecutionPlanError extends RunResolutionError {
    private readonly planConflicts: readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]];

    public constructor(
        conflicts: readonly RunExecutionPlanConflict[],
        options: Readonly<ErrorOptions> | undefined
    ) {
        super(
            `Execution plan is incompatible: ${conflicts.map(conflictMessage).join(' ')}`,
            options,
            'invalid-request'
        );
        const [ firstConflict, ...remainingConflicts ] = conflicts;

        if (firstConflict === undefined) {
            throw new TypeError('Execution plan conflicts must not be empty.');
        }

        this.name = 'RunExecutionPlanError';
        this.planConflicts = Object.freeze([ firstConflict, ...remainingConflicts ]);
    }

    public conflicts(): readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]] {
        return this.planConflicts;
    }
}

export class RunCollectionError extends Error {
    private readonly errorSubtype: RunnerError['subtype'];

    public constructor(message: string, options: Readonly<ErrorOptions>, subtype: RunnerError['subtype']) {
        super(message, options);
        this.name = 'RunCollectionError';
        this.errorSubtype = subtype;
    }

    public runnerError(): RunnerError {
        const permissionError = permissionDeniedRunnerErrorFromThrown(this.cause, {
            attributedTo: null,
            attributedToWork: null,
            boundary: null,
            diagnosticChannel: null,
            hook: null,
            phase: 'collection'
        });

        if (permissionError !== null) {
            return permissionError;
        }

        return {
            attributedToAttempt: null,
            attributedTo: null,
            attributedToWork: null,
            cause: this.cause,
            diagnostics: [],
            message: this.message,
            subtype: this.errorSubtype
        };
    }
}

export function invalidRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'invalid-request');
}

export function noTestsCollected(message: string): never {
    throw new RunResolutionError(message, undefined, 'no-tests-collected');
}
