import type { CompositeCheckBuilder, CompositeAssertionGroup } from '@overkill-dev/test/assert';
import type { CompositeAssertionReference, CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { engineCasePassedChecks } from '../../../../test-support/create-test-engine.ts';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, test, suite } from '@overkill-dev/test';
import { executeEngineCase, type EngineCaseBody } from '../../../../test-support/create-test-engine.ts';

import {
    defineReporter,
    type DefinedReporter,
    type ExecuteExecution,
    type ReporterEvent,
    type RunResult,
    createRoot,
    createTestCase,
    createTestPlan,
    execute
} from '../../../../packages/engine/engine.entry-point.ts';

import * as resourcesSubpath from '../../../../packages/test/resources.entry-point.ts';

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

async function executeObservedBodyInMode(
    body: EngineCaseBody,
    execution: ExecuteExecution
): Promise<ObservedExecution> {
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
            debug: { mode: 'off' },
            retryPolicy: null,
            execution,
            reporters: [ eventReporter(events) ],
            processUsageTracker: null,
            runFacts: {},
            startedAt: epoch.toISOString()
        }
    );

    return {
        events: events.values(),
        result
    };
}

async function executeObservedBody(body: EngineCaseBody): Promise<ObservedExecution> {
    return await executeObservedBodyInMode(body, { mode: 'serial-in-process' });
}

function firstCaseResult(observed: ObservedExecution): RunResult['perTest'][number] {
    const [ result ] = observed.result.perTest;

    if (result === undefined || result === null) {
        throw new Error('Expected result to satisfy defined.');
    }

    return result;
}

function firstRunnerError(observed: ObservedExecution): RunResult['runnerErrors'][number] {
    const [ error ] = observed.result.runnerErrors;

    if (error === undefined || error === null) {
        throw new Error('Expected error to satisfy defined.');
    }

    return error;
}

function inconclusiveFixtureChecks(
    check: CompositeCheckBuilder<'assert'>,
    observed: ObservedExecution,
    message: string
): CompositeAssertionGroup<'assert'> {
    const result = firstCaseResult(observed);
    const error = firstRunnerError(observed);
    return check.group([
        check.equal(result.verdict, 'inconclusive'),
        check.equal(result.outcome?.kind, 'inconclusive'),
        check.equal(error.subtype, 'fixture'),
        check.equal(error.message, message)
    ]);
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

const assertWrappersInjectHandles = defineCompositeAssertion({
    name: 'wrappers inject handles',
    async assert(check) {
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
        const resourceBody = resourcesSubpath.withResources(
            { store: database },
            function runWithResources(resourceScope) {
                resourceScope.assert.equal(resourceScope.resources.store.url, 'postgres://localhost');

                return resourceScope.assert.collect();
            }
        );
        return check.group([
            engineCasePassedChecks(check.annotated('engine case passed'), await executeEngineCase(runtimeBody)),
            engineCasePassedChecks(check.annotated('engine case passed'), await executeEngineCase(resourceBody))
        ]);
    }
});

const assertNestedWrappersShareAcquisition = defineCompositeAssertion({
    name: 'nested wrappers share acquisition',
    async assert(check) {
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
                    nestedScope.assert.notEqual(nestedScope.resources.database, nestedScope.runtimes.api.database);

                    return nestedScope.assert.collect();
                }
            )
        );
        const observed = await executeObservedBody(body);
        const result = firstCaseResult(observed);
        return check.group([ check.equal(result.verdict, 'pass'), check.equal(acquisitions, 2) ]);
    }
});

const assertRuntimeInternalKeysRemainNamespaced = defineCompositeAssertion({
    name: 'runtime internal keys remain namespaced',
    async assert(check) {
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
                    runtimeScope.assert.notEqual(
                        runtimeScope.runtimes.api.database,
                        runtimeScope.runtimes.admin.database
                    );
                    runtimeScope.assert.equal(runtimeScope.runtimes.api.database.url, 'postgres://localhost');

                    return runtimeScope.assert.collect();
                }
            )
        );
        const observed = await executeObservedBody(body);
        const result = firstCaseResult(observed);
        return check.group([ check.equal(result.verdict, 'pass'), check.equal(acquisitions, 2) ]);
    }
});

const assertNestedWrapperDuplicateKeysFail = defineCompositeAssertion({
    name: 'nested wrapper duplicate keys fail',
    async assert(check) {
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
        const body: EngineCaseBody = function (testScope) {
            return testScope.assert.collect();
        };
        return check.group([
            check.throws(function duplicateDirectResourceKey() {
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
            }, { message: 'Resource scope "database" is attached multiple times.' }),
            check.throws(function duplicateRuntimeKey() {
                resourcesSubpath.withRuntime(
                    apiRuntime,
                    resourcesSubpath.withRuntime<
                        typeof duplicateRuntime,
                        resourcesSubpath.RuntimeTestScope<typeof apiRuntime>
                    >(
                        duplicateRuntime,
                        body
                    )
                );
            }, { message: 'Runtime scope "api" is attached multiple times.' })
        ]);
    }
});

const assertAcquireFailureRunnerError = defineCompositeAssertion({
    name: 'acquire failure runner error',
    async assert(check) {
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
        const error = firstRunnerError(observed);
        return check.group([
            inconclusiveFixtureChecks(check, observed, 'Resource acquisition failed.'),
            check.equal(error.attributedTo?.title, 'uses database'),
            check.equal(error.cause, acquireError),
            check.deepEqual(observed.events, [
                'runner-error:Resource acquisition failed.',
                'test-end:inconclusive'
            ])
        ]);
    }
});

const assertDisposeFailureRunnerError = defineCompositeAssertion({
    name: 'dispose failure runner error',
    async assert(check) {
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
        const error = firstRunnerError(observed);
        return check.group([
            inconclusiveFixtureChecks(check, observed, 'Resource disposal failed.'),
            check.equal(error.cause, disposeError),
            check.deepEqual(observed.events, [
                'runner-error:Resource disposal failed.',
                'test-end:inconclusive'
            ])
        ]);
    }
});

const assertBroaderScopeRunnerError = defineCompositeAssertion({
    name: 'broader scope runner error',
    async assert(check) {
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
        return check.group([
            inconclusiveFixtureChecks(check, observed, 'Resource acquisition failed.'),
            check.equal(acquisitions, 0)
        ]);
    }
});

const assertConcurrentAcquireFailureRunnerError = defineCompositeAssertion({
    name: 'concurrent acquire failure runner error',
    async assert(check) {
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
            { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' }
        );
        const error = firstRunnerError(observed);
        return check.group([
            inconclusiveFixtureChecks(check, observed, 'Resource acquisition failed.'),
            check.equal(error.cause, acquireError),
            check.deepEqual(observed.events, [
                'runner-error:Resource acquisition failed.',
                'test-end:inconclusive'
            ])
        ]);
    }
});

const executionTestCase = defineMacro(
    function (title: string, assertion: CompositeAssertionReference<[], Promise<CompositeAssertionReturn<'assert'>>>) {
        return test({
            title,
            annotations: {},
            controls: {},
            async body(scope) {
                await scope.assert(assertion);

                return scope.assert.collect();
            }
        });
    }
);

export const testNode = suite('Resource binding execution', [
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
]);
