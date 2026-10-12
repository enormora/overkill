import { suite, test } from '../packages/test/test.entry-point.ts';
import { workload } from '../packages/bench/bench.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defineResource, defineRuntime, startRuntime, withResource } from '../packages/test/resources.entry-point.ts';
import { startResources as startResourceSession } from '../packages/resources/resources.entry-point.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { Engine } from '../engine/engine.ts';
import type { TestBody } from '../engine/test-node.ts';
import type { WorkloadInput, WorkloadParameters } from '../engine/workload-input.ts';
import { testNode as workloadResourceValidationTestNode } from './workload-resource-validation.test.ts';

type PackageParameters = { readonly packages: number; };

function parsePackages(parameters: WorkloadParameters): PackageParameters {
    if (typeof parameters.packages !== 'number' || parameters.packages < 1) {
        throw new TypeError('Expected a positive package count.');
    }
    return { packages: parameters.packages };
}

function workloadPlan(engine: Engine, input: WorkloadInput, body: TestBody): TestPlan {
    const child = engine.createWorkloadTestCase({
        title: 'publish',
        annotations: {},
        controls: {},
        definitionLocations: [ { kind: 'unknown' } ],
        workloads: [ { id: input.id, parameters: input.parameters, body } ]
    });
    return engine.createTestPlan(engine.createRoot({
        title: 'root',
        annotations: {},
        controls: {},
        children: [ child ]
    }));
}

export const testNode = suite('workload resources', [
    workloadResourceValidationTestNode,
    test('passes typed workload parameters to acquisition and the same value to disposal', async function (scope) {
        const observed: unknown[] = [];
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            workload: parsePackages,
            acquire({ workload: input }) {
                observed.push(input);
                return input.parameters.packages;
            },
            dispose(_handle, { workload: input }) {
                observed.push(input);
            }
        });
        const input = workload('small', { packages: 5 });
        const session = await startResourceSession({ resources: { fixture }, signal: scope.signal, workload: input });
        scope.assert.equal(session.context.fixture, 5);
        await session.disposeOnce({ signal: scope.signal });
        scope.assert.equal(observed.length, 2);
        scope.assert.equal(observed[0], observed[1]);
        scope.assert.partialDeepEqual(observed[0], { parameters: { packages: 5 }, id: input.id });
        return scope.assert.collect();
    }),
    test('rejects invalid and missing parameters before any dependency acquires', async function (scope) {
        let acquisitions = 0;
        const dependency = defineResource({
            name: 'dependency',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            acquire() {
                acquisitions += 1;
                return 1;
            }
        });
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            dependencies: { dependency },
            workload: parsePackages,
            acquire({ workload: input, dependencies }) {
                return input.parameters.packages + dependencies.dependency;
            }
        });
        await scope.assert.rejects(async function () {
            return startResourceSession({
                resources: { fixture },
                signal: scope.signal,
                workload: workload('invalid', { packages: 'five' })
            });
        }, { message: /positive package count/v });
        await scope.assert.rejects(async function () {
            return startResourceSession({ resources: { fixture }, signal: scope.signal });
        }, {
            message: /requires workload parameters/v
        });
        scope.assert.equal(acquisitions, 0);
        return scope.assert.collect();
    }),
    test('validates during engine collection without acquiring and binds direct execution', async function (scope) {
        let acquisitions = 0;
        const engine = createTestEngine();
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            workload: parsePackages,
            acquire({ workload: input }) {
                acquisitions += 1;
                return input.parameters.packages;
            }
        });
        const body = withResource(fixture, function (inner) {
            inner.assert.equal(inner.resources.fixture, 5);
            return inner.assert.collect();
        });
        const plan = workloadPlan(engine, workload('small', { packages: 5 }), body);
        scope.assert.equal(acquisitions, 0);
        scope.assert.partialDeepEqual(plan.cases[0], { workloadParameters: { packages: 5 } });
        scope.assert.partialDeepEqual(await engine.execute(plan), { summary: { passed: 1 }, runnerErrors: [] });
        scope.assert.equal(acquisitions, 1);
        return scope.assert.collect();
    }),
    test('rejects invalid and absent workload inputs during collection', function (scope) {
        let acquisitions = 0;
        const engine = createTestEngine();
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            workload: parsePackages,
            acquire() {
                acquisitions += 1;
                return 5;
            }
        });
        const body = withResource(fixture, function (inner) {
            inner.assert.equal(inner.resources.fixture, 5);
            return inner.assert.collect();
        });
        scope.assert.throws(function () {
            workloadPlan(engine, workload('invalid', { packages: 'five' }), body);
        }, { message: /positive package count/v });
        const child = engine.createWorkloadTestCase({
            title: 'missing',
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            workloads: [ { id: workload('small', { packages: 5 }).id, body } ]
        });
        scope.assert.throws(function () {
            engine.createTestPlan(
                engine.createRoot({ title: 'root', annotations: {}, controls: {}, children: [ child ] })
            );
        }, { message: /requires workload parameters/v });
        scope.assert.equal(acquisitions, 0);
        return scope.assert.collect();
    }),
    test('preserves original Unicode parameters and rejects identity mismatches', async function (scope) {
        const fixture = defineResource({
            name: 'text',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            workload(parameters) {
                return parameters;
            },
            acquire({ workload: input }) {
                return input.parameters.text;
            }
        });
        const input = workload('unicode', { text: 'e\u{301}' });
        const runtime = defineRuntime({ name: 'text', dimensions: {}, requirements: [], resources: { fixture } });
        const session = await startRuntime({ runtime, signal: scope.signal, workload: input });
        scope.assert.equal(session.context.fixture, 'e\u{301}');
        await session.disposeOnce({ signal: scope.signal });
        await scope.assert.rejects(async function () {
            return startResourceSession({
                resources: { fixture },
                signal: scope.signal,
                workload: { id: input.id, parameters: { text: 'other' } }
            });
        }, { message: /do not match/v });
        return scope.assert.collect();
    })
]);
