import { readFile } from 'node:fs/promises';
import type { TestRuntimePolicy } from '../../../engine/case-execution-context.ts';
import { withExecutionObservation } from '../../../engine/execution-observation.ts';
import type { PermissionDeniedRunnerError, RunnerError } from '../../../engine/run-result.ts';
import type { TestPlanCase } from '../../../engine/test-plan.ts';
import { createRoot, createTestCase, createTestPlan } from '../../../packages/engine/engine.entry-point.ts';
import { createPermissionDenialRuntimePolicy, createRuntimeCapabilityPolicy } from '../../../run/capability-policy.ts';

type AuditPolicyResult = {
    readonly loadErrors: readonly RunnerError[];
    readonly readable: boolean;
    readonly attempts: readonly (readonly string[])[];
    readonly runErrors: readonly RunnerError[];
};

const [ testCase ] = createTestPlan(createRoot({
    title: 'audit policy',
    annotations: {},
    controls: {},
    children: [ createTestCase({
        title: 'reads a file',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        body() {
            throw new Error('The policy callback supplies the body.');
        }
    }) ]
})).cases;

if (testCase === undefined) {
    throw new Error('Expected a planned test case.');
}

async function readSource(): Promise<string> {
    return await readFile(new URL('../../../run/permission-denial-runtime-policy.ts', import.meta.url), 'utf8');
}

function permissionLabels(errors: readonly RunnerError[]): readonly string[] {
    return [ ...new Set(errors.filter(function isPermissionError(error): error is PermissionDeniedRunnerError {
        return error.subtype === 'permission';
    }).map(function permissionLabel(error) {
        return [ error.cause.permission, error.cause.capability, error.cause.phase ].join(':');
    })) ];
}

type AuditedAttempts = {
    readonly reads: readonly boolean[];
    readonly errors: readonly (readonly string[])[];
};

async function inspectAttempts(
    policy: TestRuntimePolicy,
    plannedCase: TestPlanCase,
    expected: string
): Promise<AuditedAttempts> {
    const reads = [];
    const errors = [];
    for (let invocation = 0; invocation < 2; invocation += 1) {
        const read = await policy.runAttempt(plannedCase, { index: 0 }, async function () {
            return await policy.runAttempt(plannedCase, { index: 0 }, readSource);
        });
        reads.push(read === expected);
        errors.push(permissionLabels(policy.takeAttemptErrors(plannedCase, { index: 0 })));
    }
    return { reads, errors };
}

async function inspectPolicy(policy: TestRuntimePolicy, plannedCase: TestPlanCase): Promise<AuditPolicyResult> {
    const load = await policy.runLoad(readSource);
    const loadErrors = policy.takePendingRunErrors();
    const attempts = await inspectAttempts(policy, plannedCase, load);
    return {
        loadErrors,
        readable: load.length > 0 && attempts.reads.every(Boolean),
        attempts: attempts.errors,
        runErrors: policy.takeRunErrors()
    };
}

const unrestricted = await withExecutionObservation(async function () {
    return await inspectPolicy(createPermissionDenialRuntimePolicy(), testCase);
});
const environment = {};
const restricted = await withExecutionObservation(async function () {
    return await inspectPolicy(createRuntimeCapabilityPolicy({
        dependencies: {
            observeIpcListeners() {
                return () => undefined;
            },
            observeProcessExit() {
                return () => undefined;
            },
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        },
        observedStdout: false,
        observedStderr: false
    }), testCase);
});

process.stdout.write(JSON.stringify({ unrestricted, restricted }));
