import { execFile } from 'node:child_process';
import { runIfMain } from '#test-runner';
import { withExecutionObservation } from '../engine/execution-observation.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunnerError,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createPermissionDenialRuntimePolicy } from './capability-policy.ts';
import { RunCollectionError } from './run-errors.ts';
import { permissionAuditEnabled } from './permission-denial-runtime-policy.ts';
import { readProcessEnvironment } from './node-host-readers.ts';

const capabilityPolicyUrl = new URL('./capability-policy.ts', import.meta.url);
const observationUrl = new URL('../engine/execution-observation.ts', import.meta.url);
const testEngineUrl = new URL('../test-support/create-test-engine.ts', import.meta.url);
const permissionPolicyUrl = new URL('./permission-denial-runtime-policy.ts', import.meta.url);
const auditProbeScript = `
import { readFile } from 'node:fs/promises';
import { createPermissionDenialRuntimePolicy, createRuntimeCapabilityPolicy } from ${
    JSON.stringify(capabilityPolicyUrl.href)
};
import { withExecutionObservation } from ${JSON.stringify(observationUrl.href)};
import { createTestEngine } from ${JSON.stringify(testEngineUrl.href)};
const engine = createTestEngine();
const [testCase] = engine.createTestPlan(engine.createRoot({
    title: 'audit policy', annotations: {}, controls: {}, children: [engine.createTestCase({
        title: 'reads a file', annotations: {}, controls: {}, definitionLocations: [{kind: 'unknown'}],
        body() { throw new Error('The policy callback supplies the body.'); }
    })]
})).cases;
const readSource = () => readFile(new URL(${JSON.stringify(permissionPolicyUrl.href)}), 'utf8');
async function inspectPolicy(policy) {
    const load = await policy.runLoad(readSource);
    const loadErrors = policy.takePendingRunErrors();
    const reads = [];
    const attempts = [];
    for (let invocation = 0; invocation < 2; invocation++) {
        const read = await policy.runAttempt(testCase, {index: 0}, () =>
            policy.runAttempt(testCase, {index: 0}, readSource)
        );
        reads.push(read.includes('permissionAuditEnabled'));
        const errors = policy.takeAttemptErrors(testCase, {index: 0});
        attempts.push([...new Set(errors.filter(error => error.subtype === 'permission').map(error =>
            [error.cause.permission, error.cause.capability, error.cause.phase].join(':')
        ))]);
    }
    return {loadErrors, readable: load.includes('permissionAuditEnabled') && reads.every(Boolean),
        attempts, runErrors: policy.takeRunErrors()};
}
const unrestricted = await withExecutionObservation(() => inspectPolicy(createPermissionDenialRuntimePolicy()));
const environment = {};
const restricted = await withExecutionObservation(() => inspectPolicy(createRuntimeCapabilityPolicy({
    dependencies: {
        observeIpcListeners() { return () => undefined; },
        observeProcessExit() { return () => undefined; },
        readEnvironment() { return environment; },
        readStorage() { return null; }
    },
    observedStdout: false,
    observedStderr: false
})));
process.stdout.write(JSON.stringify({unrestricted, restricted}));
`;

type AuditProbeOutput = { readonly stdout: string; readonly stderr: string; };

async function runAuditProbe(mode: 'argv' | 'environment'): Promise<AuditProbeOutput> {
    const environment = readProcessEnvironment(process);
    return new Promise(function captureAuditProbe(resolve, reject) {
        execFile(process.execPath, [
            ...environment.NODE_V8_COVERAGE === undefined ? [] : [ '--allow-inspector', '--disable-warning=PERM0004' ],
            ...mode === 'argv' ? [ '--permission-audit' ] : [],
            '--input-type=module',
            '--eval',
            auditProbeScript
        ], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 30_000,
            env: {
                ...environment,
                NODE_OPTIONS: mode === 'environment' ? '--permission-audit' : ''
            }
        }, function finishAuditProbe(error, stdout, stderr) {
            if (error !== null) {
                reject(new Error([ stdout, stderr ].join('\n'), { cause: error }));
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}

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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/permission-denial-runtime-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        ...([ 'argv', 'environment' ] as const).map(function nativeAuditPolicy(mode) {
            return createOverkillTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
                title: `${mode} audit permits unrestricted reads and retains repeated restricted read diagnostics`,
                annotations: {},
                controls: {},
                async body(scope: OverkillScope) {
                    const result = await runAuditProbe(mode);
                    const observed: unknown = JSON.parse(result.stdout);
                    scope.assert.equal(result.stderr, '');
                    scope.assert.deepEqual(observed, {
                        unrestricted: { loadErrors: [], readable: true, attempts: [ [], [] ], runErrors: [] },
                        restricted: {
                            loadErrors: [],
                            readable: true,
                            attempts: [ [ 'FileSystemRead:fs-read:body' ], [ 'FileSystemRead:fs-read:body' ] ],
                            runErrors: []
                        }
                    });
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
                scope.assert.equal(runnerErrorPhase(diagnostics.loadError), 'load');
                scope.assert.equal(diagnostics.runError.attributedTo, null);
                scope.assert.equal(runnerErrorPhase(diagnostics.runError), 'out-of-test');

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
