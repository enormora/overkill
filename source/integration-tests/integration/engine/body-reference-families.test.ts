import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type TestNode, suite, test, table, type ParameterizedTestScope, type TestScope } from '@overkill-dev/test';

import type { ThrowingTestScope } from '@overkill-dev/test/compatibility';
import { table as subjectTable, test as subjectTest } from '../../../packages/test/test.entry-point.ts';
import {
    defineBodyReference,
    type BodyReference,
    createThrowingTestCase,
    createWorkloadTestCase
} from '../../../packages/engine/engine.entry-point.ts';

import { executeReferenceFamily, withReferenceFamilyProject } from '../../../test-support/execute-reference-family.ts';
import {
    property,
    withProperties,
    gen,
    type PropertySampleScope,
    type PropertyCaseScope
} from '../../../packages/property/property.entry-point.ts';
import {
    benchmark,
    workload,
    wallClockMeasurement,
    type BenchmarkMeasureContext,
    type BenchmarkMetrics
} from '../../../packages/bench/bench.entry-point.ts';

function reference<Scope, Result>(directory: string, name: string): BodyReference<Scope, Result> {
    const module = pathToFileURL(join(directory, 'bodies.mjs'));
    return defineBodyReference<null, Scope, Result>({
        module: { moduleUrl: module.href, exportName: name },
        realm: 'host',
        version: '1',
        input: null,
        dynamicModules: [],
        parseInput() {
            return null;
        }
    });
}
export const testNode: TestNode = suite('referenced body family composition', [
    test('preserves table parameters and throwing scope contracts', async function (scope) {
        await withReferenceFamilyProject(async function execute(directory) {
            const rows = subjectTable({
                title: 'rows',
                cases: [ 42, 42 ],
                test: reference<
                    Pick<ParameterizedTestScope<number>, 'parameters'> & {
                        readonly assert: Pick<TestScope['assert'], 'collect' | 'equal'>;
                    },
                    ReturnType<TestScope['assert']['collect']>
                >(directory, 'rows')
            });
            const throwing = createThrowingTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'throwing',
                body: reference<{ readonly assert: Pick<ThrowingTestScope['assert'], 'equal'>; }, undefined>(
                    directory,
                    'throwing'
                )
            });
            const result = await executeReferenceFamily(directory, 'microtest', [ rows, throwing ]);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 3);
        });
        return scope.assert.collect();
    }),
    test('preserves workload parameters through reference admission', async function (scope) {
        await withReferenceFamilyProject(async function execute(directory) {
            const body = defineBodyReference({
                ...reference<TestScope, ReturnType<TestScope['assert']['collect']>>(directory, 'work').reference,
                input: 42,
                parseInput(value) {
                    if (value !== 42) {
                        throw new TypeError('Expected workload input.');
                    }
                    return value;
                }
            });
            const selected = workload('large', { size: 42 });
            const node = createWorkloadTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: 'work',
                workloads: [ { id: selected.id, parameters: selected.parameters, body } ]
            });
            const result = await executeReferenceFamily(directory, 'microtest', [ node ]);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 1);
        });
        return scope.assert.collect();
    }),
    table({
        title: 'resolves implementations before generated trials',
        cases: [ 'property', 'integration' ] as const,
        caseTitle(family) {
            return family;
        },
        async test(scope) {
            const family = scope.parameters;

            await withReferenceFamilyProject(async function execute(directory) {
                const body = reference<
                    { readonly value: 42; readonly sample: PropertySampleScope<42>; },
                    ReturnType<TestScope['assert']['collect']>
                >(directory, 'sample');
                const definition = { title: 'property', generator: gen.constant(42), test: body };
                const node = property(family === 'integration' ? { ...definition, testFamily: family } : definition);
                const result = await executeReferenceFamily(directory, family, [ node ]);
                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.equal(result.summary.passed, 1);
            });
            return scope.assert.collect();
        }
    }),
    test('retains property family metadata on referenced wrappers', async function (scope) {
        await withReferenceFamilyProject(async function execute(directory) {
            const body = withProperties(
                reference<PropertyCaseScope, ReturnType<TestScope['assert']['collect']>>(directory, 'nested')
            );
            const result = await executeReferenceFamily(directory, 'property', [ subjectTest('nested', body) ]);
            scope.assert.deepEqual(
                result.perTest.map(function outcome(entry) {
                    return entry.outcome;
                }),
                [ { kind: 'pass' } ]
            );
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 1);
        });
        return scope.assert.collect();
    }),
    test('resolves measurement implementations before benchmark sampling', async function (scope) {
        await withReferenceFamilyProject(async function execute(directory) {
            const body = reference<BenchmarkMeasureContext<{ readonly size: 42; }>, BenchmarkMetrics>(
                directory,
                'measurement'
            );
            const node = benchmark('benchmark', {
                kind: 'runtime',
                workloads: [ workload('large', { size: 42 }) ],
                measurement: wallClockMeasurement(),
                measure: body,
                diagnosticMetrics: [],
                budgets: { large: { size: { maximum: 42, minimum: 42, statistic: { kind: 'observed-maximum' } } } }
            });
            const result = await executeReferenceFamily(directory, 'benchmark', [ node ]);
            scope.assert.deepEqual(result.runnerErrors, []);
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.true((result.perTest[0]?.benchmark?.samples ?? 0) > 0);
        });
        return scope.assert.collect();
    })
]);
