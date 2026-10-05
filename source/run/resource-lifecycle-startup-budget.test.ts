import { resourceAttachments } from '../attachments/attachment-context.ts';
import type { RuntimeAttachments } from '../engine/runtime-attachment.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defineResource, type AnyResourceDefinition, type ExecutionRequirement } from '../resources/resources.ts';
import { acquireResourceWithStartupBudget } from './resource-lifecycle-startup-budget.ts';

type ResourceCreationContext = {
    readonly attachments: RuntimeAttachments;
    readonly dependencies: Readonly<Record<string, never>>;
    readonly scenarios: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
};

const testCaseMetadata = {
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ]
} as const;

function startupBudget(milliseconds: number): ExecutionRequirement {
    return { kind: 'startup-budget-milliseconds', minimumMilliseconds: milliseconds };
}

function resource(
    requirements: readonly ExecutionRequirement[],
    acquire: (context: ResourceCreationContext) => unknown
): AnyResourceDefinition {
    return defineResource({
        acquire,
        dependencies: {},
        dispose: null,
        deserializeHandle(payload) {
            return payload;
        },
        name: 'database',
        requirements,
        serializeHandle: String,
        scope: 'per-run'
    });
}

function creationContext(signal: AbortSignal): ResourceCreationContext {
    return { attachments: resourceAttachments('test'), dependencies: {}, scenarios: {}, signal };
}

async function neverResolvingResource(context: ResourceCreationContext): Promise<never> {
    return await new Promise(function waitForAbort(_resolve, reject) {
        context.signal.addEventListener('abort', function rejectAfterAbort() {
            const reason: unknown = context.signal.reason;

            reject(reason instanceof Error ? reason : new Error(String(reason)));
        }, { once: true });
    });
}

export const testNode = createOverkillSuite({
    ...testCaseMetadata,
    title: 'source/run/resource-lifecycle-startup-budget.test.ts',
    children: [
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource startup budget delegates resources without budget requirements',
            async body(scope: OverkillScope) {
                const controller = new AbortController();
                let observedSignal: AbortSignal | null = null;
                const handle = await acquireResourceWithStartupBudget(
                    resource([], function acquire(context) {
                        observedSignal = context.signal;

                        return 'handle';
                    }),
                    creationContext(controller.signal)
                );

                scope.assert.equal(handle, 'handle');
                scope.assert.equal(observedSignal, controller.signal);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource startup budget ignores invalid budget requirements',
            async body(scope: OverkillScope) {
                const controller = new AbortController();
                let observedSignal: AbortSignal | null = null;
                const handle = await acquireResourceWithStartupBudget(
                    resource([
                        { kind: 'serial' },
                        { kind: 'startup-budget-milliseconds', minimumMilliseconds: Number.NaN },
                        { kind: 'startup-budget-milliseconds', minimumMilliseconds: -1 }
                    ], function acquire(context) {
                        observedSignal = context.signal;

                        return 'handle';
                    }),
                    creationContext(controller.signal)
                );

                scope.assert.equal(handle, 'handle');
                scope.assert.equal(observedSignal, controller.signal);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource startup budget passes an isolated child signal',
            async body(scope: OverkillScope) {
                const controller = new AbortController();
                let observedSignal = controller.signal;
                const handle = await acquireResourceWithStartupBudget(
                    resource([ startupBudget(1000) ], function acquire(context) {
                        observedSignal = context.signal;

                        return 'handle';
                    }),
                    creationContext(controller.signal)
                );

                scope.assert.equal(handle, 'handle');
                scope.assert.notEqual(observedSignal, controller.signal);
                scope.assert.equal(observedSignal.aborted, false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource startup budget aborts resources that exceed the budget',
            async body(scope: OverkillScope) {
                const controller = new AbortController();

                await scope.assert.rejects(async function acquireTimedOutResource() {
                    await acquireResourceWithStartupBudget(
                        resource([ startupBudget(0) ], neverResolvingResource),
                        creationContext(controller.signal)
                    );
                }, { message: 'Resource "database" exceeded startup budget of 0 ms.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...testCaseMetadata,
            title: 'resource startup budget forwards parent aborts to the child signal',
            async body(scope: OverkillScope) {
                const controller = new AbortController();
                const result = acquireResourceWithStartupBudget(
                    resource([ startupBudget(1000) ], neverResolvingResource),
                    creationContext(controller.signal)
                );
                const reason = new Error('parent aborted');

                controller.abort(reason);
                await scope.assert.rejects(async function awaitParentAbort() {
                    await result;
                }, { message: 'parent aborted' });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
