import { runIfMain } from '#test-runner';
import {
    createSuite,
    createTestCase,
    defaultFailureArtifactPolicy,
    serializeValue,
    type FailureArtifactPolicy,
    type RunResult,
    type TestFailure,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { microtestProfileSchema } from '../config/schema.ts';
import { formatFailure } from '../reporters/line-failure-rendering.ts';
import { testNode as debugLifecycle } from './test-debug-lifecycle.test.ts';
import { testNode as debugDiagnostics } from './test-debug.test.ts';
import { testNode as debugRecording } from './test-debug-recording.test.ts';
import { createReportingContext } from './reporting-context.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
const text = 'abcdefgh';
const limitedPolicy = {
    ...defaultFailureArtifactPolicy,
    serialization: { ...defaultFailureArtifactPolicy.serialization, stringBytes: 4 }
};

async function failedComparison(
    policy: FailureArtifactPolicy,
    beforeAssertion: (() => Promise<void>) | null
): Promise<RunResult> {
    const engine = createTestEngine();
    const plan = engine.createTestPlan(engine.createRoot({
        annotations: {},
        controls: {},
        title: 'diagnostics',
        children: [ engine.createTestCase({
            ...metadata,
            title: 'compares text',
            async body(scope) {
                await scope.drainMicrotasks();
                if (beforeAssertion !== null) {
                    await beforeAssertion();
                }
                scope.assert.equal(text, 'different');
                return scope.assert.collect();
            }
        }) ]
    }));
    return await engine.execute(plan, {
        debug: { mode: 'off' },
        failureArtifacts: policy,
        execution: { mode: 'serial-in-process' },
        retryPolicy: null,
        reporters: [],
        runFacts: {},
        startedAt: '1970-01-01T00:00:00.000Z'
    });
}

function firstAssertionFailure(result: RunResult): Extract<TestFailure, { readonly kind: 'assertion'; }> {
    const outcome = result.perTest[0]?.outcome;
    if (outcome?.kind !== 'fail') {
        throw new Error('Expected a failed comparison.');
    }
    const failure = outcome.failures[0];
    if (failure.kind !== 'assertion') {
        throw new Error('Expected a structured assertion failure.');
    }
    return failure;
}

export const testNode = createSuite({
    ...metadata,
    title: 'failure artifact policy',
    children: [
        debugDiagnostics,
        debugRecording,
        debugLifecycle,
        createTestCase({
            ...metadata,
            title: 'legacy reporter contexts retain default failure rendering',
            async body(scope: TestScope) {
                const result = await failedComparison(defaultFailureArtifactPolicy, null);
                const failure = firstAssertionFailure(result);
                const context = createReportingContext({ projectRoot: null });
                const legacy = { relativizeLocationPath: context.relativizeLocationPath };
                const rendered = formatFailure(failure, legacy);
                scope.assert.deepEqual(rendered, formatFailure(failure, context));
                scope.assert.includes(rendered.join('\n'), text);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'profile limits default independently and reject unbounded values',
            body(scope: TestScope) {
                const profile = microtestProfileSchema.parse({
                    testFamily: 'microtest',
                    failureArtifacts: { capturedOutputBytes: 16, rendering: { diffLines: 2 } }
                });
                scope.assert.deepEqual(profile.failureArtifacts, {
                    ...defaultFailureArtifactPolicy,
                    capturedOutputBytes: 16,
                    rendering: { ...defaultFailureArtifactPolicy.rendering, diffLines: 2 }
                });
                for (
                    const capturedOutputBytes of [
                        0,
                        -1,
                        1.5,
                        Number.POSITIVE_INFINITY,
                        Number.MAX_SAFE_INTEGER + 1
                    ]
                ) {
                    scope.assert.equal(
                        microtestProfileSchema
                            .safeParse({
                                testFamily: 'microtest',
                                failureArtifacts: { capturedOutputBytes }
                            })
                            .success,
                        false
                    );
                }
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'concurrent executions isolate serialization limits and restore their caller',
            async body(scope: TestScope) {
                const [ short, full ] = await Promise.all([
                    failedComparison(limitedPolicy, null),
                    failedComparison(defaultFailureArtifactPolicy, null)
                ]);
                scope.assert.partialDeepEqual(firstAssertionFailure(short).checks[0].actual, {
                    kind: 'string',
                    value: 'abcd'
                });
                scope.assert.deepEqual(firstAssertionFailure(full).checks[0].actual, serializeValue(text));
                scope.assert.partialDeepEqual(serializeValue(text), { kind: 'string', value: text, truncation: null });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'nested execution restores the surrounding serialization budget',
            async body(scope: TestScope) {
                const result = await failedComparison(limitedPolicy, async function executeNestedComparison() {
                    await failedComparison(defaultFailureArtifactPolicy, null);
                });
                scope.assert.partialDeepEqual(firstAssertionFailure(result).checks[0].actual, {
                    kind: 'string',
                    value: 'abcd'
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'human diff limits do not change structured assertion evidence',
            async body(scope: TestScope) {
                const result = await failedComparison(defaultFailureArtifactPolicy, null);
                const failure = firstAssertionFailure(result);
                const context = createReportingContext({
                    projectRoot: null,
                    failureArtifacts: { ...defaultFailureArtifactPolicy, rendering: { diffLines: 1, valueBytes: 3 } }
                });
                const rendered = formatFailure(failure, context).join('\n');
                scope.assert.equal(rendered.includes('truncated'), true);
                scope.assert.equal(rendered.includes(text), false);
                scope.assert.deepEqual(failure.checks[0].actual, serializeValue(text));
                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
