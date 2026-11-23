import { join } from 'node:path';
import { suite, test, type TestScope } from '@overkill-dev/test';
import { consumerCaseFiles } from './consumer-fixture.ts';
import { performanceCases, type PerformanceCase } from './performance-cases.ts';

const project = join(import.meta.dirname, '../../target/performance-fixture');

function filesFor(workload: PerformanceCase['workload']): ReadonlyMap<string, string> {
    const spec = performanceCases.find(function usesWorkload(candidate) {
        return candidate.workload === workload;
    });
    if (spec === undefined) {
        throw new Error(`Missing workload ${workload}.`);
    }
    return consumerCaseFiles(project, spec);
}

export const testNode = suite('performance consumer fixtures', [
    test('generate the declared cases for every workload', function (scope) {
        for (const spec of performanceCases) {
            const files = consumerCaseFiles(project, spec);
            const actual = Array.from(files.values(), function caseCount(source) {
                return Array.from(source.matchAll(/"case \d+"/gu)).length;
            });
            const expected = Array.from({ length: spec.files }, function casesPerFile() {
                return spec.suitesPerFile * spec.casesPerSuite;
            });
            scope.assert.deepEqual({ workload: spec.id, files: actual }, { workload: spec.id, files: expected });
        }
        return scope.assert.collect();
    }),
    test('make the compiler and runtime resolve the same type-test source', function (scope: TestScope) {
        const files = filesFor('compiler');
        const source = files.get('file-0.mts');
        scope.require.defined(source);
        scope.assert.includes(source, '/source/packages/type-test/type-test.entry-point.ts');
        scope.assert.includes(source, 'sameType<number, number>()');
        return scope.assert.collect();
    }),
    test('put one failed assertion in the first reporter fixture file', function (scope) {
        const failingFiles = Array.from(filesFor('report-line-failure')).filter(function containsFailure([ , source ]) {
            return source.includes('scope.assert.deepEqual(');
        });
        const locations = failingFiles.map(function countFailures([ name, source ]) {
            return { name, failures: Array.from(source.matchAll(/scope\.assert\.deepEqual\(/gu)).length };
        });
        scope.assert.deepEqual(locations, [ { name: 'file-0.mjs', failures: 1 } ]);
        return scope.assert.collect();
    })
]);
