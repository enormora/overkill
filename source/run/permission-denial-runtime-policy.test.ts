import diagnosticsChannel from 'node:diagnostics_channel';
import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { createExecutionObservation, withExecutionObservation } from '../engine/execution-observation.ts';
import type { RunnerError } from '../packages/engine/engine.entry-point.ts';

import {
    createPermissionDenialRuntimePolicy,
    createPermissionDiagnosticsSubscriptions,
    permissionAuditEnabled,
    type PermissionDiagnosticsOptions
} from './permission-denial-runtime-policy.ts';
import { RunCollectionError } from './run-errors.ts';

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
    return diagnosticsChannel.channel('node:permission-model:fs');
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
        const policy = createPermissionDenialRuntimePolicy({ auditDiagnostics: 'ignore', auditEnabled: false });
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

export const testNode: TestNode = suite('Permission denial runtime policy', [
    table({
        title: 'permission audit policy',
        cases: diagnosticPolicies,
        caseTitle(policy) {
            return `${policy.auditEnabled}, ${policy.auditDiagnostics}`;
        },
        async test(scope) {
            const policy = scope.parameters;

            const diagnostics = await recordedPermissionDiagnostics(policy);
            scope.assert.deepEqual(diagnostics, policy.expected);
            return scope.assert.collect();
        }
    }),
    test(
        'permission audit mode follows Node option quoting and command-line precedence',
        function (scope) {
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
    ),
    test(
        'records run-scope Node permission diagnostics',
        async function (scope) {
            const diagnostics = await runScopePermissionDiagnostics();

            scope.assert.equal(diagnostics.loadError.attributedTo, null);
            scope.assert.equal(runnerErrorCauseField(diagnostics.loadError, 'phase'), 'load');
            scope.assert.equal(diagnostics.runError.attributedTo, null);
            scope.assert.equal(runnerErrorCauseField(diagnostics.runError, 'phase'), 'out-of-test');

            return scope.assert.collect();
        }
    ),
    test('ignores permission drop diagnostics', async function (scope) {
        const policy = createPermissionDenialRuntimePolicy({ auditDiagnostics: 'ignore', auditEnabled: false });
        const channel = await readPermissionDiagnosticChannel();

        publishPermissionDropDiagnostic(channel);
        const pendingErrors = policy.takePendingRunErrors();
        const runErrors = policy.takeRunErrors();

        scope.assert.deepEqual(pendingErrors, []);
        scope.assert.deepEqual(runErrors, []);

        return scope.assert.collect();
    }),
    test('RunCollectionError reports access denials as permission runner errors', function (scope) {
        const error = new RunCollectionError('Collection failed.', { cause: accessDeniedError() }, 'loader');
        const runnerError = error.runnerError();

        scope.assert.equal(runnerError.subtype, 'permission');
        scope.assert.equal(runnerError.message, 'Permission denied: FileSystemRead for /project/input.txt.');

        return scope.assert.collect();
    })
]);
