import { type TestNode, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine } from '../../../test-support/create-test-engine.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    createTemporaryDirectoryResource,
    defineImplementationReference,
    defineResource,
    defineResourceOwnerReference,
    defineResourceReference,
    type ResourceReference,
    type ResourceOwnerReference,
    startResources
} from '../../../packages/resources/resources.entry-point.ts';

import { withResources } from '../../../packages/test/resources.entry-point.ts';
import {
    type BodyReference,
    defineBodyReference,
    type Engine,
    type TestPlan,
    type RunResult
} from '../../../packages/engine/engine.entry-point.ts';

import { builtinTestFamily } from '../../../engine/builtin-test-families.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

type NativeResource = ResourceReference<'native', ResourceOwnerReference<URL>, null, Readonly<Record<string, never>>>;

function referencedResource(directory: string, exportName: string): NativeResource {
    return defineResourceReference({
        name: 'native',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        scenarios: {},
        workload: null,
        consumer: null,
        owner: defineResourceOwnerReference<URL, null>(defineImplementationReference({
            module: { moduleUrl: pathToFileURL(join(directory, 'owner.mjs')).href, exportName },
            realm: 'host',
            version: '1',
            input: null,
            dynamicModules: [],
            parseInput(input) {
                if (input !== null) {
                    throw new TypeError('Owner input must be null.');
                }
                return input;
            }
        }))
    });
}

function bodyPlan(engine: Engine, body: BodyReference | EngineCaseBody): TestPlan {
    return engine.createTestPlan(engine.createRoot({
        ...metadata,
        title: 'root',
        children: [ engine.createTestCase({ ...metadata, title: 'uses references', body }) ]
    }));
}

type ExecutionRequest = {
    readonly directory: string;
    readonly engine: Engine;
    readonly plan: TestPlan;
    readonly signal: AbortSignal;
};

async function executePrepared(request: ExecutionRequest): Promise<RunResult> {
    await using prepared = await request.engine.prepareFamily({
        testPlan: request.plan,
        testFamily: builtinTestFamily('integration'),
        projectRoot: request.directory,
        settings: null,
        signal: request.signal
    });
    const collected = await prepared.collect({
        workIds: request.plan.cases.map(function work(testCase) {
            return testCase.workId;
        }),
        signal: request.signal
    });
    return await request.engine.execute(collected, {
        signal: request.signal,
        execution: { mode: 'serial-in-process' },
        debug: { mode: 'off' },
        retryPolicy: null,
        reporters: [],
        runFacts: {},
        startedAt: '2026-11-15T00:00:00.000Z'
    });
}

async function withOwnerModule<Value>(
    signal: Readonly<AbortSignal>,
    source: string,
    use: (directory: string) => Promise<Value>
): Promise<Value> {
    await using temporary = await startResources({
        resources: { directory: createTemporaryDirectoryResource('directory') },
        signal
    });
    const directory = temporary.context.directory.path;
    await writeFile(join(directory, 'owner.mjs'), source);
    return await use(directory);
}

export const testNode: TestNode = suite('engine resource references', [
    test('preloads wrapped resource implementations before executing a case', async function (scope) {
        await withOwnerModule(
            scope.signal,
            [
                "export const owner={version:'1',implementation:{",
                'acquire(){return new URL("file:///native")},dispose:null,exposeHandle:null,serializeHandle:null}};'
            ]
                .join('\n'),
            async function execute(directory) {
                const resource = referencedResource(directory, 'owner');
                const engine = createTestEngine();
                const plan = bodyPlan(
                    engine,
                    withResources({ resource }, function useResource(inner) {
                        inner.assert.equal(inner.resources.resource.href, 'file:///native');
                        return inner.assert.collect();
                    })
                );
                const result = await executePrepared({ directory, engine, plan, signal: scope.signal });
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.runnerErrors.length, 0);
            }
        );
        return scope.assert.collect();
    }),
    test('composes body and owner references in the same verified module build', async function (scope) {
        await withOwnerModule(
            scope.signal,
            [
                "import {Value} from './value.mjs';",
                "export const owner={version:'1',implementation:{acquire(){return new Value()},dispose:null,exposeHandle:null,serializeHandle:null}};"
            ]
                .join('\n'),
            async function execute(directory) {
                await writeFile(join(directory, 'value.mjs'), 'export class Value {}');
                await writeFile(
                    join(directory, 'body.mjs'),
                    "import {Value} from './value.mjs';export const body={version:'1',implementation(scope){scope.assert.equal(scope.resources.resource instanceof Value,true);return scope.assert.collect()}};"
                );
                const resource = referencedResource(directory, 'owner');
                const engine = createTestEngine();
                const body = defineBodyReference({
                    module: { moduleUrl: pathToFileURL(join(directory, 'body.mjs')).href, exportName: 'body' },
                    realm: 'host',
                    version: '1',
                    input: null,
                    dynamicModules: [],
                    parseInput(input) {
                        if (input !== null) {
                            throw new TypeError('Expected null');
                        }
                        return input;
                    }
                });
                const plan = bodyPlan(engine, withResources({ resource }, body));
                const result = await executePrepared({ directory, engine, plan, signal: scope.signal });
                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.runnerErrors.length, 0);
            }
        );
        return scope.assert.collect();
    }),
    test('keeps workload bindings separate while sharing an admitted owner module', async function (scope) {
        await withOwnerModule(
            scope.signal,
            [
                "export const owner={version:'1',implementation:{",
                'acquire(context){return new URL("file:///"+context.workload.parameters.value)},',
                'dispose:null,exposeHandle:null,serializeHandle:null}};'
            ]
                .join('\n'),
            async function execute(directory) {
                const resource = Object.freeze({
                    ...referencedResource(directory, 'owner'),
                    workload(parameters: Readonly<Record<string, unknown>>) {
                        if (typeof parameters.value !== 'string') {
                            throw new TypeError('Expected a workload value.');
                        }
                        return { value: parameters.value };
                    }
                });
                const engine = createTestEngine();
                const variants = [ 'first', 'second' ].map(function variant(value) {
                    return {
                        id: { name: value, params: { value: JSON.stringify(value) } },
                        parameters: { value },
                        body: withResources({ resource }, function useResource(inner) {
                            inner.assert.equal(inner.resources.resource.href, `file:///${value}`);
                            return inner.assert.collect();
                        })
                    };
                });
                const [ first, ...remaining ] = variants;
                if (first === undefined) {
                    throw new TypeError('Expected workload variants.');
                }
                const plan = engine.createTestPlan(engine.createRoot({
                    ...metadata,
                    title: 'workloads',
                    children: [ engine.createWorkloadTestCase({
                        ...metadata,
                        title: 'uses the selected workload',
                        workloads: [ first, ...remaining ]
                    }) ]
                }));
                const result = await executePrepared({ directory, engine, plan, signal: scope.signal });
                scope.assert.equal(result.summary.passed, 2);
                scope.assert.equal(result.runnerErrors.length, 0);
            }
        );
        return scope.assert.collect();
    }),
    test('rejects missing resource exports before acquiring inline dependencies', async function (scope) {
        await withOwnerModule(scope.signal, 'export const unrelated=1;', async function execute(directory) {
            let acquisitions = 0;
            const dependency = defineResource({
                name: 'inline',
                scope: 'per-case',
                requirements: [],
                dispose: null,
                acquire() {
                    acquisitions += 1;
                    return 1;
                }
            });
            const resource = referencedResource(directory, 'missing');
            const engine = createTestEngine();
            const plan = bodyPlan(
                engine,
                withResources({ resource, dependency }, function useResource(inner) {
                    return inner.assert.collect();
                })
            );
            await scope.assert.rejects(async function missingExport() {
                await executePrepared({ directory, engine, plan, signal: scope.signal });
            }, { message: 'Missing implementation export: missing' });
            scope.assert.equal(acquisitions, 0);
        });
        return scope.assert.collect();
    })
]);
