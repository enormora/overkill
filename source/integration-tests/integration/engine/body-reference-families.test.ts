import { type TestNode, suite, test, table, type ParameterizedTestScope, type TestScope } from '@overkill-dev/test';
import type { EngineCaseBody } from '../../../test-support/create-test-engine.ts';
import { table as subjectTable, test as subjectTest } from '../../../packages/test/test.entry-point.ts';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
    defineBodyReference,
    type BodyReference,
    createThrowingTestCase,
    createWorkloadTestCase
} from '../../../packages/engine/engine.entry-point.ts';

import type { ThrowingTestScope } from '@overkill-dev/test/compatibility';

import { executeReferenceFamily } from '../../../test-support/execute-reference-family.ts';
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
async function fixture(use: (directory: string) => Promise<void>): Promise<void> {
    await using directory = await mkdtempDisposable(join(tmpdir(), 'overkill-reference-family-'));
    await writeFile(
        join(directory.path, 'bodies.mjs'),
        [
            "export const rows={version:'1',implementation(scope){scope.assert.equal(scope.parameters,42);",
            'return scope.assert.collect();}};',
            "export const throwing={version:'1',implementation(scope){scope.assert.equal(42,42);return undefined;}};",
            "export const work={version:'1',implementation(scope,input){scope.assert.equal(input,42);",
            'return scope.assert.collect();}};',
            "export const sample={version:'1',implementation({value,sample}){sample.assert.equal(value,42);",
            'return sample.assert.collect();}};',
            "export const nested={version:'1',implementation(scope){scope.assert.equal(typeof scope.forall,'function');",
            'return scope.assert.collect();}};',
            "export const measurement={version:'1',implementation(context){",
            'const measured=context.sample.measure(function operation(){return context.workload.parameters.size;});',
            'return {size:measured.value};}};'
        ]
            .join('\n')
    );
    await use(directory.path);
}
export const testNode: TestNode = suite('referenced body family composition', [
    test('preserves table parameters and throwing scope contracts', async function (scope) {
        await fixture(async function execute(directory) {
            const rows = subjectTable({
                title: 'rows',
                cases: [ 42, 42 ],
                test: reference<
                    Pick<ParameterizedTestScope<number>, 'parameters'> & {
                        readonly assert: Pick<TestScope['assert'], 'equal' | 'collect'>;
                    },
                    ReturnType<EngineCaseBody>
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
        await fixture(async function execute(directory) {
            const body = defineBodyReference({
                ...reference<TestScope, ReturnType<EngineCaseBody>>(directory, 'work').reference,
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
            return `${family}`;
        },
        async test(scope) {
            const family = scope.parameters;

            await fixture(async function execute(directory) {
                const body = reference<
                    { readonly value: 42; readonly sample: PropertySampleScope<42>; },
                    ReturnType<EngineCaseBody>
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
        await fixture(async function execute(directory) {
            const body = withProperties(reference<PropertyCaseScope, ReturnType<EngineCaseBody>>(directory, 'nested'));
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
        await fixture(async function execute(directory) {
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
