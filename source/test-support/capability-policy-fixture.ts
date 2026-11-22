import diagnosticsChannel from 'node:diagnostics_channel';
import type { NormalizedConfig, RunCommand, RunRequest } from '../packages/run/run.entry-point.ts';
import type { RunnerError } from '../packages/engine/engine.entry-point.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import type { RuntimeCapabilityPolicy } from '../run/capability-policy.ts';
import type { WebStorageLike } from '../run/capability-policy-snapshots.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

type PolicyTestCase = Parameters<RuntimeCapabilityPolicy['runAttempt']>[0];

export type ExpectedPermissionDiagnosticError = {
    readonly capability: string;
    readonly message: string | null;
    readonly permission: string;
    readonly resource: string;
};

type PermissionDiagnosticChannel = { readonly publish: (message: unknown) => void; };

export const loadEnvPolicyFixturePath = 'source/integration-tests/runtime/fixtures/load-env-policy.test.ts';

export const passingFixturePath = 'source/integration-tests/runtime/fixtures/passing.test.ts';

const policyAnnotations: PolicyTestCase['annotations'] = {
    ownership: [],
    tags: []
};

const policyControls: PolicyTestCase['controls'] = {
    capture: null,
    duplicateExecution: null,
    timeoutMilliseconds: null
};

export const policyTestCase: PolicyTestCase = {
    bodyOrigin: null,
    workloadParameters: null,
    annotations: policyAnnotations,
    controls: policyControls,
    execution: {
        body: async function unusedPolicyTestBody() {
            throw new Error('Policy test body should not run.');
        },
        bodyMode: 'builder',
        kind: 'body'
    },
    definitionLocations: [ { kind: 'unknown' as const } ],
    id: {
        file: 'source/run/run-capability-policy.test.ts',
        title: 'policy case',
        params: null,
        suite: [ 'runtime policy' ]
    },
    resourceAttachments: {
        directResources: [],
        resourceGraph: [],
        runtimeGraphs: []
    },
    suitePath: [
        { definitionLocations: [ { kind: 'unknown' as const } ], title: 'runtime policy' }
    ],
    testFamily: null,
    workId: createDefaultWorkId({
        file: 'source/run/run-capability-policy.test.ts',
        title: 'policy case',
        params: null,
        suite: [ 'runtime policy' ]
    })
};

export function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export function firstRunnerError(errors: readonly RunnerError[]): RunnerError {
    const [ error ] = errors;

    if (error === undefined) {
        throw new Error('Expected a runner error.');
    }

    return error;
}

export function runnerErrorPhase(runnerError: RunnerError | undefined): unknown {
    const cause = runnerError?.cause;

    return typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'phase')
        ? Reflect.get(cause, 'phase')
        : null;
}

export function runnerErrorMessageIncludes(runnerError: RunnerError | undefined, text: string): boolean {
    return String(runnerError?.message).includes(text);
}

export function errorCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'capability')) {
        return String(Reflect.get(cause, 'capability'));
    }

    return null;
}

export function errorStringField(error: RunnerError, field: string): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, field)) {
        const value: unknown = Reflect.get(cause, field);

        return typeof value === 'string' ? value : null;
    }

    return null;
}

function errorStrictness(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'strictness')) {
        return String(Reflect.get(cause, 'strictness'));
    }

    return null;
}

export function compareNullableStrings(first: string | null, second: string | null): number {
    return String(first).localeCompare(String(second));
}

export function errorCapabilityAndStrictness(error: RunnerError): readonly [string | null, string | null] {
    return [ errorCapability(error), errorStrictness(error) ];
}

export function createStorage(values: ReadonlyMap<string, string>): WebStorageLike {
    return {
        get length() {
            return values.size;
        },
        getItem(key) {
            return values.get(key) ?? null;
        },
        key(index) {
            return Array.from(values.keys())[index] ?? null;
        }
    };
}

export function installNoPolicyRestriction(): () => void {
    return function restoreNoPolicyRestriction(): void {
        return undefined;
    };
}

export async function readPermissionDiagnosticChannel(): Promise<PermissionDiagnosticChannel> {
    return diagnosticsChannel.channel('node:permission-model:fs');
}

export function publishPermissionDiagnostic(
    channel: PermissionDiagnosticChannel,
    permission: string,
    resource: string
): void {
    channel.publish({ permission, resource });
}

export function createSparseStorage(): WebStorageLike {
    return {
        length: 2,
        getItem() {
            return null;
        },
        key(index) {
            return index === 0 ? null : 'missing';
        }
    };
}
