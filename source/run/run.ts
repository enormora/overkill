import { randomBytes } from 'node:crypto';
import { createWallClock } from '@enormora/wall-clock';
import { serializeValue, type SerializedValue as SerializedValueShape } from '../compare/serialized-value.ts';
import { createExecute, type Execute } from '../engine/execution.ts';
import type { CaseId } from '../engine/identity.ts';
import { createReporterDispatcher, type Reporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { Metadata } from '../engine/test-node.ts';
import type { TestPlan } from '../engine/test-plan.ts';

const minimumSeedValue = 0n;
const seedByteLength = 8;

export type SerializedValue = SerializedValueShape;

export type RunSelection = {
    readonly kind: 'all';
};

export type RunShard = {
    readonly index: number;
    readonly total: number;
};

export type RunExecutionRequest = {
    readonly mode: 'concurrent-in-process';
};

export type RunSeed = {
    readonly value: bigint | null;
};

export type RunDebugRequest = {
    readonly mode: 'off';
    readonly selectors: readonly [];
};

export type RunLoaderConfig = {
    readonly sourceMaps: boolean;
    readonly stripMode: 'strip-only' | 'transform';
};

export type RunConfig = {
    readonly loader: RunLoaderConfig;
    readonly reporters: readonly Reporter[];
    readonly runtimeStateDir: string;
};

export type RunRequest = {
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly coverage: false;
    readonly debug: RunDebugRequest;
    readonly execution: RunExecutionRequest;
    readonly order: 'plan';
    readonly paths: readonly string[];
    readonly profile: 'microtest';
    readonly seed: RunSeed;
    readonly selection: RunSelection;
    readonly shard: RunShard;
    readonly verbose: false;
};

export type RunCommand = {
    readonly config: RunConfig;
    readonly request: RunRequest;
    readonly testPlan: TestPlan;
};

export type RunFacts = {
    readonly cases: readonly RunCaseFacts[];
    readonly environment: RunEnvironmentFacts;
    readonly execution: RunExecutionFacts;
    readonly loader: RunLoaderConfig;
    readonly reproducibility: RunReproducibilityFacts;
};

export type RunCaseFacts = {
    readonly id: CaseId;
    readonly metadata: SerializedValue;
};

export type RunEnvironmentFacts = {
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly runtimeStateDir: string;
};

export type RunExecutionFacts = {
    readonly baselineUpdateMode: 'none';
    readonly capture: 'buffered' | 'live';
    readonly coverage: false;
    readonly debug: RunDebugRequest;
    readonly mode: 'concurrent-in-process';
    readonly order: 'plan';
    readonly profile: 'microtest';
    readonly verbose: false;
};

export type RunReproducibilityFacts = {
    readonly seed: string;
    readonly shard: RunShard;
};

export type ResolvedRun = {
    readonly config: RunConfig;
    readonly facts: RunFacts;
    readonly reporters: readonly Reporter[];
    readonly request: RunRequest;
    readonly testPlan: TestPlan;
};

export type RunResolutionErrorCode = 'invalid-request' | 'unsupported-request';

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

export type RunApiDependencies = {
    readonly createSeed: () => bigint;
    readonly execute: Execute;
    readonly node: {
        readonly arch: string;
        readonly platform: string;
        readonly version: string;
    };
    readonly readStartedAt: () => string;
};

export type RunApi = {
    readonly resolveRun: (command: RunCommand) => Promise<ResolvedRun>;
    readonly run: (command: RunCommand) => Promise<RunResult>;
};

function unsupportedRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'unsupported-request');
}

function invalidRequest(message: string): never {
    throw new RunResolutionError(message, undefined, 'invalid-request');
}

function validateRunPaths(request: RunRequest): void {
    if (request.paths.length > 0) {
        unsupportedRequest('Path discovery is not implemented yet.');
    }
}

function validateRunShard(request: RunRequest): void {
    if (request.shard.index !== 0 || request.shard.total !== 1) {
        unsupportedRequest('Sharding is not implemented yet.');
    }
}

function validateRunSeed(request: RunRequest): void {
    if (request.seed.value !== null && request.seed.value < minimumSeedValue) {
        invalidRequest('Run seed must be a nonnegative bigint.');
    }
}

function validateRunRequest(request: RunRequest): void {
    validateRunPaths(request);
    validateRunShard(request);
    validateRunSeed(request);
}

function resolvedSeed(request: RunRequest, dependencies: RunApiDependencies): bigint {
    return request.seed.value ?? dependencies.createSeed();
}

function copyLoaderConfig(loader: RunLoaderConfig): RunLoaderConfig {
    return {
        sourceMaps: loader.sourceMaps,
        stripMode: loader.stripMode
    };
}

function copyRunShard(shard: RunShard): RunShard {
    return {
        index: shard.index,
        total: shard.total
    };
}

function copyRunRequest(request: RunRequest): RunRequest {
    return {
        baselineUpdateMode: request.baselineUpdateMode,
        capture: request.capture,
        coverage: request.coverage,
        debug: {
            mode: request.debug.mode,
            selectors: []
        },
        execution: { mode: request.execution.mode },
        order: request.order,
        paths: Array.from(request.paths),
        profile: request.profile,
        seed: { value: request.seed.value },
        selection: { kind: request.selection.kind },
        shard: copyRunShard(request.shard),
        verbose: request.verbose
    };
}

function copyRunConfig(config: RunConfig): RunConfig {
    return {
        loader: copyLoaderConfig(config.loader),
        reporters: Array.from(config.reporters),
        runtimeStateDir: config.runtimeStateDir
    };
}

function runCaseFacts(metadata: Metadata, id: CaseId): RunCaseFacts {
    return {
        id,
        metadata: serializeValue(metadata)
    };
}

function createRunFacts(
    command: RunCommand,
    request: RunRequest,
    config: RunConfig,
    dependencies: RunApiDependencies
): RunFacts {
    return {
        cases: command.testPlan.cases.map(function toRunCaseFacts(testCase) {
            return runCaseFacts(testCase.metadata, testCase.id);
        }),
        environment: {
            node: {
                arch: dependencies.node.arch,
                platform: dependencies.node.platform,
                version: dependencies.node.version
            },
            runtimeStateDir: config.runtimeStateDir
        },
        execution: {
            baselineUpdateMode: request.baselineUpdateMode,
            capture: request.capture,
            coverage: request.coverage,
            debug: request.debug,
            mode: request.execution.mode,
            order: request.order,
            profile: request.profile,
            verbose: request.verbose
        },
        loader: config.loader,
        reproducibility: {
            seed: resolvedSeed(request, dependencies).toString(),
            shard: request.shard
        }
    };
}

function freezeValue<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object') {
        for (const propertyValue of Object.values(value)) {
            freezeValue(propertyValue);
        }

        Object.freeze(value);
    }

    return value;
}

function createResolvedRun(command: RunCommand, dependencies: RunApiDependencies): ResolvedRun {
    validateRunRequest(command.request);

    const request = freezeValue(copyRunRequest(command.request));
    const config = freezeValue(copyRunConfig(command.config));
    const facts = freezeValue(createRunFacts(command, request, config, dependencies));

    return freezeValue({
        config,
        facts,
        reporters: config.reporters,
        request,
        testPlan: command.testPlan
    });
}

export function createRunApi(dependencies: RunApiDependencies): RunApi {
    return {
        async resolveRun(command) {
            return createResolvedRun(command, dependencies);
        },

        async run(command) {
            const resolvedRun = createResolvedRun(command, dependencies);

            return await dependencies.execute(resolvedRun.testPlan, {
                execution: { mode: 'concurrent-in-process' },
                reporters: resolvedRun.reporters,
                runFacts: resolvedRun.facts,
                startedAt: dependencies.readStartedAt()
            });
        }
    };
}

function createDefaultSeed(): bigint {
    return randomBytes(seedByteLength).readBigUInt64BE();
}

const defaultWallClock = createWallClock();
const defaultRunApi = createRunApi({
    createSeed: createDefaultSeed,
    execute: createExecute({
        reporterDispatcher: createReporterDispatcher({ wallClock: defaultWallClock }),
        wallClock: defaultWallClock
    }),
    node: {
        arch: process.arch,
        platform: process.platform,
        version: process.versions.node
    },
    readStartedAt() {
        const startedAt = new Date(defaultWallClock.currentTimestampInMilliseconds);

        return startedAt.toISOString();
    }
});

export async function resolveRun(command: RunCommand): Promise<ResolvedRun> {
    return await defaultRunApi.resolveRun(command);
}

export async function run(command: RunCommand): Promise<RunResult> {
    return await defaultRunApi.run(command);
}
