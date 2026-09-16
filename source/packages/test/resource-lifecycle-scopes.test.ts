import {
    createSuite,
    createTestCase,
    createTestPlanFromTestFiles,
    defineReporter,
    execute,
    type DefinedReporter,
    type ReporterEvent,
    type RunResult,
    type TestBody,
    type TestNode,
    type TestPlan,
    type TestScope
} from '../engine/engine.entry-point.ts';
import { createResourceLifecycleRuntimePolicy } from '../../run/resource-lifecycle.ts';
import * as resourcesSubpath from './resources.entry-point.ts';

type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;
type LifecycleHandle = {
    readonly id: number;
    readonly name: string;
};
type LifecycleResource = resourcesSubpath.ResourceDefinition<
    string,
    LifecycleHandle,
    EmptyResourceDependencies,
    LifecycleHandle
>;
type LifecycleRecord = {
    readonly acquisitions: number;
    readonly disposals: number;
    readonly seenIds: readonly number[];
};
type LifecycleRecords = Readonly<Record<string, LifecycleRecord>>;
type ObservedExecution = {
    readonly result: RunResult;
};
type LifecycleRecorder = {
    readonly records: () => LifecycleRecords;
    readonly resource: (name: string, resourceScope: resourcesSubpath.ResourceScope) => LifecycleResource;
};

const epoch = new Date(0);
const projectedScopes = [ 'per-file', 'per-run', 'per-suite' ] as const;
type ProjectedResourceScope = typeof projectedScopes[number];

function isProjectedScope(scope: resourcesSubpath.ResourceScope): scope is ProjectedResourceScope {
    return projectedScopes.includes(scope as ProjectedResourceScope);
}

function eventReporter(): DefinedReporter {
    return defineReporter(function createFixtureReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name: 'fixture-events',
            onEvent(event: ReporterEvent) {
                Object.is(event, event);

                return undefined;
            },
            onFinish: null,
            sinks: []
        };
    });
}

async function executeObservedPlan(testPlan: TestPlan): Promise<ObservedExecution> {
    const result = await execute(testPlan, {
        execution: { mode: 'serial-in-process' },
        reporters: [ eventReporter() ],
        resourceUsageTracker: null,
        runFacts: {},
        runtimePolicy: createResourceLifecycleRuntimePolicy(testPlan.cases),
        startedAt: epoch.toISOString()
    });

    return { result };
}

function scopeRecord(record: LifecycleRecord | undefined): LifecycleRecord {
    if (record === undefined) {
        throw new Error('Expected lifecycle record.');
    }

    return record;
}

function projectedHandle(payload: resourcesSubpath.ResourceProjectionPayload, name: string): LifecycleHandle {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new Error(`Invalid projection for ${name}.`);
    }

    return {
        id: Number(Reflect.get(payload, 'id')),
        name: String(Reflect.get(payload, 'name'))
    };
}

function projectedLifecycleResource(
    name: string,
    resourceScope: ProjectedResourceScope,
    acquireRecord: (name: string) => LifecycleHandle,
    disposeRecord: (handle: LifecycleHandle) => void
): LifecycleResource {
    return resourcesSubpath.defineResource({
        name,
        scope: resourceScope,
        requirements: [],
        acquire(): LifecycleHandle {
            return acquireRecord(name);
        },
        deserializeHandle(payload): LifecycleHandle {
            return projectedHandle(payload, name);
        },
        dispose(handle): void {
            disposeRecord(handle);
        },
        serializeHandle(handle) {
            return { id: handle.id, name: handle.name };
        }
    });
}

function localLifecycleResource(
    name: string,
    resourceScope: Exclude<resourcesSubpath.ResourceScope, ProjectedResourceScope>,
    acquireRecord: (name: string) => LifecycleHandle,
    disposeRecord: (handle: LifecycleHandle) => void
): LifecycleResource {
    return resourcesSubpath.defineResource({
        name,
        scope: resourceScope,
        requirements: [],
        acquire(): LifecycleHandle {
            return acquireRecord(name);
        },
        dispose(handle): void {
            disposeRecord(handle);
        }
    });
}

function lifecycleRecords(records: ReadonlyMap<string, LifecycleRecord>): LifecycleRecords {
    return Object.fromEntries(
        Array.from(records, function copyRecord([ key, record ]) {
            return [
                key,
                {
                    acquisitions: record.acquisitions,
                    disposals: record.disposals,
                    seenIds: Array.from(record.seenIds)
                }
            ];
        })
    );
}

function createLifecycleRecorder(): LifecycleRecorder {
    const records = new Map<string, LifecycleRecord>();

    function updateRecord(name: string, replace: (record: LifecycleRecord) => LifecycleRecord): void {
        records.set(name, replace(scopeRecord(records.get(name))));
    }

    function acquireRecord(name: string): LifecycleHandle {
        const record = scopeRecord(records.get(name));
        const nextRecord = {
            ...record,
            acquisitions: record.acquisitions + 1
        };

        records.set(name, nextRecord);

        return { id: nextRecord.acquisitions, name };
    }

    function disposeRecord(handle: LifecycleHandle): void {
        updateRecord(handle.name, function withDisposal(record) {
            return {
                ...record,
                disposals: record.disposals + 1,
                seenIds: [ ...record.seenIds, handle.id ]
            };
        });
    }

    function resource(name: string, resourceScope: resourcesSubpath.ResourceScope): LifecycleResource {
        records.set(name, { acquisitions: 0, disposals: 0, seenIds: [] });

        return isProjectedScope(resourceScope)
            ? projectedLifecycleResource(name, resourceScope, acquireRecord, disposeRecord)
            : localLifecycleResource(name, resourceScope, acquireRecord, disposeRecord);
    }

    return {
        records() {
            return lifecycleRecords(records);
        },
        resource
    };
}

function caseNode(title: string, body: TestBody): TestNode {
    return createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title,
        annotations: {},
        controls: {},
        body
    });
}

function fileSuite(firstTitle: string, secondTitle: string, body: TestBody): TestNode {
    return createSuite({
        definitionLocations: [ { kind: 'unknown' } ],
        title: 'api',
        annotations: {},
        controls: {},
        children: [
            caseNode(firstTitle, body),
            caseNode(secondTitle, body)
        ]
    });
}

function lifecycleTestPlan(body: TestBody): TestPlan {
    return createTestPlanFromTestFiles({
        files: [
            {
                file: 'source/first.test.ts',
                testNode: fileSuite('first', 'second', body)
            },
            {
                file: 'source/second.test.ts',
                testNode: fileSuite('third', 'fourth', body)
            }
        ],
        root: {
            annotations: {},
            controls: {},
            title: 'resource scope fixtures'
        }
    });
}

function singleCaseLifecycleTestPlan(body: TestBody): TestPlan {
    return createTestPlanFromTestFiles({
        files: [
            {
                file: 'source/projection.test.ts',
                testNode: caseNode('uses projection', body)
            }
        ],
        root: {
            annotations: {},
            controls: {},
            title: 'resource projection fixtures'
        }
    });
}

async function assertRunnerManagedResourceScopes(scope: TestScope): Promise<void> {
    const recorder = createLifecycleRecorder();
    const resources = {
        caseResource: recorder.resource('caseResource', 'per-case'),
        fileResource: recorder.resource('fileResource', 'per-file'),
        runResource: recorder.resource('runResource', 'per-run'),
        suiteResource: recorder.resource('suiteResource', 'per-suite'),
        workerResource: recorder.resource('workerResource', 'shared-per-worker')
    };
    const body = resourcesSubpath.withResources(resources, function runWithResources(resourceScope) {
        resourceScope.assert.equal(resourceScope.resources.runResource.name, 'runResource');
        resourceScope.assert.equal(resourceScope.resources.fileResource.name, 'fileResource');
        resourceScope.assert.equal(resourceScope.resources.suiteResource.name, 'suiteResource');
        resourceScope.assert.equal(resourceScope.resources.caseResource.name, 'caseResource');
        resourceScope.assert.equal(resourceScope.resources.workerResource.name, 'workerResource');

        return resourceScope.assert.collect();
    });
    const observed = await executeObservedPlan(lifecycleTestPlan(body));

    scope.assert.deepEqual(
        observed.result.perTest.map(function toVerdict(result) {
            return result.verdict;
        }),
        [ 'pass', 'pass', 'pass', 'pass' ]
    );
    scope.assert.deepEqual(recorder.records(), {
        caseResource: { acquisitions: 4, disposals: 4, seenIds: [ 1, 2, 3, 4 ] },
        fileResource: { acquisitions: 2, disposals: 2, seenIds: [ 1, 2 ] },
        runResource: { acquisitions: 1, disposals: 1, seenIds: [ 1 ] },
        suiteResource: { acquisitions: 2, disposals: 2, seenIds: [ 1, 2 ] },
        workerResource: { acquisitions: 1, disposals: 1, seenIds: [ 1 ] }
    });
}

async function assertRunnerManagedArrayProjection(scope: TestScope): Promise<void> {
    const projectedResource = resourcesSubpath.defineResource({
        name: 'projected',
        scope: 'per-run',
        requirements: [],
        acquire(): LifecycleHandle {
            return { id: 1, name: 'projected' };
        },
        deserializeHandle(payload): LifecycleHandle {
            if (!Array.isArray(payload)) {
                throw new TypeError('Expected array projection.');
            }

            return { id: Number(payload[0]), name: String(payload[1]) };
        },
        dispose: null,
        serializeHandle(handle) {
            return [ handle.id, handle.name ];
        }
    });
    const body = resourcesSubpath.withResource(projectedResource, function runWithProjection(resourceScope) {
        resourceScope.assert.deepEqual(resourceScope.resources.projected, { id: 1, name: 'projected' });

        return resourceScope.assert.collect();
    });
    const observed = await executeObservedPlan(singleCaseLifecycleTestPlan(body));

    scope.assert.deepEqual(
        observed.result.perTest.map(function toVerdict(result) {
            return result.verdict;
        }),
        [ 'pass' ]
    );
}

async function assertRunnerManagedInvalidProjection(scope: TestScope): Promise<void> {
    const projectedResource = resourcesSubpath.defineResource({
        name: 'projected',
        scope: 'per-run',
        requirements: [],
        acquire(): LifecycleHandle {
            return { id: 1, name: 'projected' };
        },
        deserializeHandle(): LifecycleHandle {
            throw new Error('Invalid projection should not deserialize.');
        },
        dispose: null,
        serializeHandle() {
            return Number.NaN;
        }
    });
    const body = resourcesSubpath.withResource(projectedResource, function runWithProjection(resourceScope) {
        return resourceScope.assert.collect();
    });
    const observed = await executeObservedPlan(singleCaseLifecycleTestPlan(body));

    scope.assert.deepEqual(
        observed.result.perTest.map(function toVerdict(result) {
            return result.verdict;
        }),
        [ 'inconclusive' ]
    );
    scope.assert.equal(
        observed.result.runnerErrors[0]?.message,
        'Resource "projected" returned a non-JSON projection payload.'
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/resource-lifecycle-scopes.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrappers honor runner-managed lifecycle scopes',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertRunnerManagedResourceScopes(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrappers support runner-managed array projections',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertRunnerManagedArrayProjection(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'resource wrappers reject invalid runner-managed projections',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertRunnerManagedInvalidProjection(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
