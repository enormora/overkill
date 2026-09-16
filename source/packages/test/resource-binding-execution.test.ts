import {
    createRoot,
    createSuite,
    createTestCase,
    createTestPlan,
    defineReporter,
    execute,
    type DefinedReporter,
    type ExecuteExecution,
    type ReporterEvent,
    type RunResult,
    type TestBody,
    type TestNode,
    type TestScope
} from '../engine/engine.entry-point.ts';
import * as resourcesSubpath from './resources.entry-point.ts';

type Database = {
    readonly url: string;
};
type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;
type DatabaseResource = resourcesSubpath.ResourceDefinition<'database', Database, EmptyResourceDependencies>;

type ObservedExecution = {
    readonly events: readonly string[];
    readonly result: RunResult;
};
type EventLog = {
    readonly add: (event: string) => void;
    readonly values: () => readonly string[];
};

const epoch = new Date(0);

function createEventLog(): EventLog {
    const events: string[] = [];

    return {
        add(event) {
            events.push(event);
        },
        values() {
            return Array.from(events);
        }
    };
}

function eventReporter(events: EventLog): DefinedReporter {
    return defineReporter(function createFixtureReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'fixture-events',
            onEvent(event: ReporterEvent) {
                if (event.kind === 'runner-error') {
                    events.add(`runner-error:${event.error.message}`);
                } else if (event.kind === 'test-end') {
                    events.add(`test-end:${event.verdict}`);
                }
            },
            onFinish: null,
            sinks: []
        };
    });
}

async function executeObservedBodyInMode(body: TestBody, execution: ExecuteExecution): Promise<ObservedExecution> {
    const events = createEventLog();
    const result = await execute(
        createTestPlan(createRoot({
            children: [
                createTestCase({
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: 'uses database',
                    annotations: {},
                    controls: {},
                    body
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        })),
        {
            execution,
            reporters: [ eventReporter(events) ],
            resourceUsageTracker: null,
            runFacts: {},
            startedAt: epoch.toISOString()
        }
    );

    return {
        events: events.values(),
        result
    };
}

async function executeObservedBody(body: TestBody): Promise<ObservedExecution> {
    return await executeObservedBodyInMode(body, { mode: 'serial-in-process' });
}

function firstCaseResult(scope: TestScope, observed: ObservedExecution): RunResult['perTest'][number] {
    const [ result ] = observed.result.perTest;

    scope.require.defined(result);

    return result;
}

function firstRunnerError(scope: TestScope, observed: ObservedExecution): RunResult['runnerErrors'][number] {
    const [ error ] = observed.result.runnerErrors;

    scope.require.defined(error);

    return error;
}

function assertInconclusiveFixture(
    scope: TestScope,
    observed: ObservedExecution,
    message: string
): RunResult['runnerErrors'][number] {
    const result = firstCaseResult(scope, observed);
    const error = firstRunnerError(scope, observed);

    scope.assert.equal(result.verdict, 'inconclusive');
    scope.assert.equal(result.outcome?.kind, 'inconclusive');
    scope.assert.equal(error.subtype, 'fixture');
    scope.assert.equal(error.message, message);

    return error;
}

function databaseResource(): DatabaseResource {
    return resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            return { url: 'postgres://localhost' };
        },
        dispose: null
    });
}

function countedDatabaseResource(recordAcquisition: () => void): DatabaseResource {
    return resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            recordAcquisition();

            return { url: 'postgres://localhost' };
        },
        dispose: null
    });
}

async function assertWrappersInjectHandles(scope: TestScope): Promise<void> {
    const database = databaseResource();
    const runtime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const runtimeBody = resourcesSubpath.withRuntime(runtime, function runWithRuntime(runtimeScope) {
        runtimeScope.assert.equal(runtimeScope.runtimes.api.database.url, 'postgres://localhost');

        return runtimeScope.assert.collect();
    });
    const resourceBody = resourcesSubpath.withResources({ store: database }, function runWithResources(resourceScope) {
        resourceScope.assert.equal(resourceScope.resources.store.url, 'postgres://localhost');

        return resourceScope.assert.collect();
    });

    scope.assert.equal(Array.isArray(await runtimeBody(scope)), true);
    scope.assert.equal(Array.isArray(await resourceBody(scope)), true);
}

async function assertNestedWrappersShareAcquisition(scope: TestScope): Promise<void> {
    let acquisitions = 0;
    const database = countedDatabaseResource(function recordAcquisition(): void {
        acquisitions += 1;
    });
    const runtime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const body = resourcesSubpath.withResource(
        database,
        resourcesSubpath.withRuntime<
            typeof runtime,
            resourcesSubpath.ResourceTestScope<Record<'database', typeof database>>
        >(
            runtime,
            function runWithNestedScope(nestedScope) {
                nestedScope.assert.equal(nestedScope.resources.database.url, 'postgres://localhost');
                nestedScope.assert.equal(nestedScope.runtimes.api.database.url, 'postgres://localhost');
                nestedScope.assert.equal(nestedScope.resources.database, nestedScope.runtimes.api.database);

                return nestedScope.assert.collect();
            }
        )
    );
    const observed = await executeObservedBody(body);
    const result = firstCaseResult(scope, observed);

    scope.assert.equal(result.verdict, 'pass');
    scope.assert.equal(acquisitions, 1);
}

async function assertRuntimeInternalKeysRemainNamespaced(scope: TestScope): Promise<void> {
    let acquisitions = 0;
    const database = countedDatabaseResource(function recordAcquisition(): void {
        acquisitions += 1;
    });
    const apiRuntime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const adminRuntime = resourcesSubpath.defineRuntime({
        name: 'admin',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const body = resourcesSubpath.withRuntime(
        apiRuntime,
        resourcesSubpath.withRuntime<typeof adminRuntime, resourcesSubpath.RuntimeTestScope<typeof apiRuntime>>(
            adminRuntime,
            function runWithRuntimeKeys(runtimeScope) {
                runtimeScope.assert.equal(runtimeScope.runtimes.api.database, runtimeScope.runtimes.admin.database);
                runtimeScope.assert.equal(runtimeScope.runtimes.api.database.url, 'postgres://localhost');

                return runtimeScope.assert.collect();
            }
        )
    );
    const observed = await executeObservedBody(body);
    const result = firstCaseResult(scope, observed);

    scope.assert.equal(result.verdict, 'pass');
    scope.assert.equal(acquisitions, 1);
}

async function assertNestedWrapperDuplicateKeysFail(scope: TestScope): Promise<void> {
    const database = databaseResource();
    const apiRuntime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database },
        requirements: []
    });
    const duplicateRuntime = resourcesSubpath.defineRuntime({
        name: 'api',
        dimensions: { role: 'duplicate' },
        resources: {},
        requirements: []
    });
    const body = function runWithScope(testScope: TestScope): ReturnType<TestBody> {
        return testScope.assert.collect();
    };

    scope.assert.throws(function duplicateDirectResourceKey() {
        resourcesSubpath.withResource(
            database,
            resourcesSubpath.withResource<
                typeof database,
                resourcesSubpath.ResourceTestScope<Record<'database', typeof database>>
            >(
                database,
                body
            )
        );
    }, { message: 'Resource scope "database" is attached multiple times.' });
    scope.assert.throws(function duplicateRuntimeKey() {
        resourcesSubpath.withRuntime(
            apiRuntime,
            resourcesSubpath.withRuntime<typeof duplicateRuntime, resourcesSubpath.RuntimeTestScope<typeof apiRuntime>>(
                duplicateRuntime,
                body
            )
        );
    }, { message: 'Runtime scope "api" is attached multiple times.' });
}

async function assertAcquireFailureRunnerError(scope: TestScope): Promise<void> {
    const acquireError = new Error('database unavailable');
    const failingResource = resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire() {
            throw acquireError;
        },
        dispose: null
    });
    const observed = await executeObservedBody(resourcesSubpath.withResource(
        failingResource,
        function runWithDatabase(resourceScope) {
            return resourceScope.assert.collect();
        }
    ));
    const error = assertInconclusiveFixture(scope, observed, 'Resource acquisition failed.');

    scope.assert.equal(error.attributedTo?.title, 'uses database');
    scope.assert.equal(error.cause, acquireError);
    scope.assert.deepEqual(observed.events, [
        'runner-error:Resource acquisition failed.',
        'test-end:inconclusive'
    ]);
}

async function assertDisposeFailureRunnerError(scope: TestScope): Promise<void> {
    const disposeError = new Error('database disposal failed');
    const failingResource = resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            return { url: 'postgres://localhost' };
        },
        dispose() {
            throw disposeError;
        }
    });
    const observed = await executeObservedBody(resourcesSubpath.withResource(
        failingResource,
        function runWithDatabase(resourceScope) {
            resourceScope.assert.equal(resourceScope.resources.database.url, 'postgres://localhost');

            return resourceScope.assert.collect();
        }
    ));
    const error = assertInconclusiveFixture(scope, observed, 'Resource disposal failed.');

    scope.assert.equal(error.cause, disposeError);
    scope.assert.deepEqual(observed.events, [
        'runner-error:Resource disposal failed.',
        'test-end:inconclusive'
    ]);
}

async function assertBroaderScopeRunnerError(scope: TestScope): Promise<void> {
    let acquisitions = 0;
    const runResource = resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-run',
        requirements: [],
        acquire(): Database {
            acquisitions += 1;

            return { url: 'postgres://localhost' };
        },
        deserializeHandle(payload: string) {
            return { url: payload };
        },
        dispose: null,
        serializeHandle(handle) {
            return handle.url;
        }
    });
    const observed = await executeObservedBody(resourcesSubpath.withResource(
        runResource,
        function runWithDatabase(resourceScope) {
            return resourceScope.assert.collect();
        }
    ));

    assertInconclusiveFixture(scope, observed, 'Resource acquisition failed.');
    scope.assert.equal(acquisitions, 0);
}

async function assertConcurrentAcquireFailureRunnerError(scope: TestScope): Promise<void> {
    const acquireError = new Error('database unavailable');
    const failingResource = resourcesSubpath.defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire() {
            throw acquireError;
        },
        dispose: null
    });
    const observed = await executeObservedBodyInMode(
        resourcesSubpath.withResource(
            failingResource,
            function runWithDatabase(resourceScope) {
                return resourceScope.assert.collect();
            }
        ),
        { mode: 'concurrent-in-process' }
    );
    const error = assertInconclusiveFixture(scope, observed, 'Resource acquisition failed.');

    scope.assert.equal(error.cause, acquireError);
    scope.assert.deepEqual(observed.events, [
        'runner-error:Resource acquisition failed.',
        'test-end:inconclusive'
    ]);
}

function executionTestCase(title: string, assertion: (scope: TestScope) => Promise<void>): TestNode {
    return createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title,
        annotations: {},
        controls: {},
        async body(scope: TestScope) {
            await assertion(scope);

            return scope.assert.collect();
        }
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/resource-binding-execution.test.ts',
    annotations: {},
    controls: {},
    children: [
        executionTestCase('resource wrappers inject runtime and direct handles', assertWrappersInjectHandles),
        executionTestCase(
            'nested resource wrappers inject composed scope and share acquisition',
            assertNestedWrappersShareAcquisition
        ),
        executionTestCase(
            'nested runtime wrappers keep internal resource keys namespaced',
            assertRuntimeInternalKeysRemainNamespaced
        ),
        executionTestCase(
            'nested resource wrappers reject duplicate public keys',
            assertNestedWrapperDuplicateKeysFail
        ),
        executionTestCase(
            'resource wrappers report acquire failures as fixture runner errors',
            assertAcquireFailureRunnerError
        ),
        executionTestCase(
            'resource wrappers report dispose failures as fixture runner errors',
            assertDisposeFailureRunnerError
        ),
        executionTestCase(
            'resource wrappers reject broader resource scopes before acquisition',
            assertBroaderScopeRunnerError
        ),
        executionTestCase(
            'resource wrappers report concurrent acquire failures as fixture runner errors',
            assertConcurrentAcquireFailureRunnerError
        )
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
