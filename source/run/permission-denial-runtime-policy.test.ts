import { runIfMain } from '#test-runner';
import { createExecutionObservation, withExecutionObservation } from '../engine/execution-observation.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createPermissionDenialRuntimePolicy } from './capability-policy.ts';
import { RunCollectionError } from './run-errors.ts';
import {
    createPermissionDiagnosticsSubscriptions,
    permissionAuditEnabled,
    type PermissionDiagnosticsOptions
} from './permission-denial-runtime-policy.ts';

type PermissionDiagnosticChannel = { readonly publish: (message: unknown) => void; };

function firstRunnerError(errors: readonly RunnerError[]): RunnerError {
    const [ error ] = errors;

    if (error === undefined) {
        throw new Error('Expected a runner error.');
    }

    return error;
}

function runnerErrorCauseField(runnerError: RunnerError, field: string): unknown {
    const { cause } = runnerError;

    return typeof cause === 'object' && cause !== null && Object.hasOwn(cause, field)
        ? Reflect.get(cause, field)
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

function publishPermissionDropDiagnostic(channel: PermissionDiagnosticChannel): void {
    channel.publish({ drop: true, permission: 'FileSystemRead', resource: '' });
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
    return await withExecutionObservation(async function observePermissionRun() {
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
    });
}

async function recordedPermissionDiagnostics(options: PermissionDiagnosticsOptions): Promise<readonly string[]> {
    return await withExecutionObservation(async function () {
        const observation = createExecutionObservation();
        const errors: RunnerError[] = [];
        const channel = await readPermissionDiagnosticChannel();
        let phase: 'body' | 'load' | 'out-of-test' = 'load';
        createPermissionDiagnosticsSubscriptions(observation, function () {
            return phase;
        }, function (error) {
            errors.push(error);
        }, options);
        await observation.run(async function () {
            for (const currentPhase of [ 'load', 'body', 'out-of-test' ] as const) {
                phase = currentPhase;
                publishPermissionDiagnostic(channel, 'FileSystemRead', '/project/input.txt');
                publishPermissionDiagnostic(channel, 'FileSystemWrite', '/project/output.txt');
            }
            await Promise.resolve();
        });
        observation.stop();
        return errors.map(function diagnosticLabel(error) {
            return `${String(runnerErrorCauseField(error, 'phase'))}:${
                String(runnerErrorCauseField(error, 'capability'))
            }`;
        });
    });
}

const enforcedDiagnostics = [
    'load:fs-read',
    'load:fs-write',
    'body:fs-read',
    'body:fs-write',
    'out-of-test:fs-read',
    'out-of-test:fs-write'
];
const diagnosticPolicies = [
    { auditEnabled: true, auditDiagnostics: 'ignore', expected: [] },
    {
        auditEnabled: true,
        auditDiagnostics: 'report',
        expected: [ 'load:fs-write', 'body:fs-read', 'body:fs-write', 'out-of-test:fs-write' ]
    },
    { auditEnabled: false, auditDiagnostics: 'ignore', expected: enforcedDiagnostics },
    { auditEnabled: false, auditDiagnostics: 'report', expected: enforcedDiagnostics }
] as const;

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/permission-denial-runtime-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        ...diagnosticPolicies.map(function diagnosticPolicy(policy) {
            return createOverkillTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `audit enabled ${policy.auditEnabled}, audit diagnostics ${policy.auditDiagnostics}`,
                annotations: {},
                controls: {},
                async body(scope: OverkillScope) {
                    const diagnostics = await recordedPermissionDiagnostics(policy);
                    scope.assert.deepEqual(diagnostics, policy.expected);
                    return scope.assert.collect();
                }
            });
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'permission audit mode follows Node option quoting and command-line precedence',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.false(permissionAuditEnabled([], ''));
                scope.assert.true(permissionAuditEnabled([ '--permission-audit' ], ''));
                scope.assert.true(permissionAuditEnabled([], '"--permission-audit" --trace-warnings'));
                scope.assert.true(permissionAuditEnabled([ '--permission_audit=false' ], ''));
                scope.assert.false(permissionAuditEnabled([ '--no-permission-audit' ], '--permission-audit'));
                scope.assert.true(permissionAuditEnabled([ '--permission-audit' ], '--no-permission-audit'));
                scope.assert.false(permissionAuditEnabled([ '--permission-audit', '--no-permission-audit' ], ''));
                scope.assert.false(permissionAuditEnabled([], '--title="example --permission-audit"'));
                scope.assert.false(permissionAuditEnabled([], '--title="example \\" --permission-audit"'));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'permission denial runtime policy records run-scope Node permission diagnostics',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const diagnostics = await runScopePermissionDiagnostics();

                scope.assert.equal(diagnostics.loadError.attributedTo, null);
                scope.assert.equal(runnerErrorCauseField(diagnostics.loadError, 'phase'), 'load');
                scope.assert.equal(diagnostics.runError.attributedTo, null);
                scope.assert.equal(runnerErrorCauseField(diagnostics.runError, 'phase'), 'out-of-test');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'permission denial runtime policy ignores permission drop diagnostics',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const policy = createPermissionDenialRuntimePolicy();
                const channel = await readPermissionDiagnosticChannel();

                publishPermissionDropDiagnostic(channel);
                const pendingErrors = policy.takePendingRunErrors();
                const runErrors = policy.takeRunErrors();

                scope.assert.deepEqual(pendingErrors, []);
                scope.assert.deepEqual(runErrors, []);

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

await runIfMain(import.meta, testNode);
