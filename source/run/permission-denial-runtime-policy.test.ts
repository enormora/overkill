import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createPermissionDenialRuntimePolicy } from './capability-policy.ts';
import { RunCollectionError } from './run-errors.ts';

type PermissionDiagnosticChannel = { readonly publish: (message: unknown) => void; };

function firstRunnerError(errors: readonly RunnerError[]): RunnerError {
    const [ error ] = errors;

    if (error === undefined) {
        throw new Error('Expected a runner error.');
    }

    return error;
}

function runnerErrorPhase(runnerError: RunnerError): unknown {
    const { cause } = runnerError;

    return typeof cause === 'object' && cause !== null && Object.hasOwn(cause, 'phase')
        ? Reflect.get(cause, 'phase')
        : null;
}

async function readPermissionDiagnosticChannel(): Promise<PermissionDiagnosticChannel> {
    const diagnosticsChannel = await import('node:diagnostics_channel');

    return diagnosticsChannel.default.channel('node:permission-model:fs');
}

function publishPermissionDiagnostic(
    channel: PermissionDiagnosticChannel,
    permission: string,
    resource: string
): void {
    channel.publish({ permission, resource });
}

function accessDeniedError(): Error {
    return Object.assign(new Error('read denied'), {
        code: 'ERR_ACCESS_DENIED',
        permission: 'FileSystemRead',
        resource: '/project/input.txt'
    });
}

async function runScopePermissionDiagnostics(): Promise<{
    readonly loadError: RunnerError;
    readonly runError: RunnerError;
}> {
    const policy = createPermissionDenialRuntimePolicy();
    const channel = await readPermissionDiagnosticChannel();

    publishPermissionDiagnostic(channel, 'FileSystemRead', '/project/load.txt');
    const loadError = firstRunnerError(policy.takePendingRunErrors());
    await policy.runLoad(async function finishLoading() {
        return undefined;
    });
    publishPermissionDiagnostic(channel, 'FileSystemWrite', '/project/after.txt');

    return {
        loadError,
        runError: firstRunnerError(policy.takeRunErrors())
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/permission-denial-runtime-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'permission denial runtime policy records run-scope Node permission diagnostics',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const diagnostics = await runScopePermissionDiagnostics();

                scope.assert.equal(diagnostics.loadError.attributedTo, null);
                scope.assert.equal(runnerErrorPhase(diagnostics.loadError), 'load');
                scope.assert.equal(diagnostics.runError.attributedTo, null);
                scope.assert.equal(runnerErrorPhase(diagnostics.runError), 'out-of-test');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'RunCollectionError reports access denials as permission runner errors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const error = new RunCollectionError('Collection failed.', { cause: accessDeniedError() }, 'loader');
                const runnerError = error.runnerError();

                scope.assert.equal(runnerError.subtype, 'permission');
                scope.assert.equal(runnerError.message, 'Permission denied: FileSystemRead for /project/input.txt.');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
