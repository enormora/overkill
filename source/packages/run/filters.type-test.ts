import type { IsEqual } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { assignableFrom, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import type { CaseId } from '../engine/engine.entry-point.ts';
import { isAssignableTo, type IsAssignable } from '../../test-support/type-relations.ts';
import * as filters from './filters.entry-point.ts';
import type { RunFilter, RunSelection, RunStringFilterField } from './filters.entry-point.ts';

type FilterPackageValueExport = keyof {
    readonly all: true;
    readonly any: true;
    readonly caseId: true;
    readonly contains: true;
    readonly equals: true;
    readonly file: true;
    readonly glob: true;
    readonly not: true;
    readonly owner: true;
    readonly params: true;
    readonly parseRunFilterExpression: true;
    readonly runtime: true;
    readonly runtimeDimension: true;
    readonly runtimeScenario: true;
    readonly runtimeVariant: true;
    readonly suite: true;
    readonly tag: true;
    readonly title: true;
    readonly workload: true;
};

declare const equalsUnderTest: typeof filters.equals;

export const testNode = suite('Typed test selection filters', [
    test('exposes the typed filter helper surface without test-family matching', function (scope) {
        scope.assert(sameType<IsEqual<keyof typeof filters, FilterPackageValueExport>, true>());
        scope.assert(
            sameType<RunStringFilterField, 'file' | 'owner' | 'params' | 'suite' | 'tag' | 'title' | 'workload'>()
        );
        return scope.assert.collect();
    }),
    test('creates typed filter trees for run selections', function (scope) {
        const id: CaseId = {
            file: 'source/users.test.ts',
            params: null,
            suite: [ 'users' ],
            title: 'creates a user'
        };
        const filter = filters.all([
            filters.tag('fast'),
            filters.not(filters.tag('flaky')),
            filters.any([ filters.file('source/**'), filters.title('user') ]),
            filters.owner('@users'),
            filters.suite('users'),
            filters.params('primary'),
            filters.caseId(id),
            filters.runtime('browser'),
            filters.runtimeVariant('browser', 'chromium'),
            filters.runtimeDimension('browser', 'engine', 'chromium'),
            filters.runtimeScenario('api', 'api', 'payments-500')
        ]);

        scope.assert(sameType.withActual<true>(), isAssignableTo<RunFilter>()(filter));
        scope.assert(sameType<
            IsAssignable<{
                readonly filter: RunFilter;
                readonly kind: 'filter';
            }, RunSelection>,
            true
        >());
        return scope.assert.collect();
    }),
    test('exposes composite helper signatures', function (scope) {
        scope.assert(
            sameType<
                IsEqual<typeof filters.all, (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter>,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<typeof filters.any, (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter>,
                true
            >()
        );
        scope.assert(sameType<IsEqual<typeof filters.not, (filter: RunFilter) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.caseId, (id: CaseId) => RunFilter>, true>());
        scope.assert(
            sameType<IsEqual<typeof filters.parseRunFilterExpression, (expression: string) => RunFilter>, true>()
        );
        scope.assert(sameType<IsEqual<typeof filters.runtime, (name: string) => RunFilter>, true>());
        scope.assert(
            sameType<IsEqual<typeof filters.runtimeVariant, (name: string, variantId: string) => RunFilter>, true>()
        );
        scope.assert(
            sameType<
                IsEqual<
                    typeof filters.runtimeDimension,
                    (name: string, dimensionName: string, value: string) => RunFilter
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<
                    typeof filters.runtimeScenario,
                    (runtime: string, scenario: string, value: string) => RunFilter
                >,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('exposes generic string helper signatures', function (scope) {
        scope.assert(
            sameType<IsEqual<typeof filters.equals, (field: RunStringFilterField, value: string) => RunFilter>, true>()
        );
        scope.assert(
            sameType<
                IsEqual<typeof filters.contains, (field: RunStringFilterField, value: string) => RunFilter>,
                true
            >()
        );
        scope.assert(
            sameType<IsEqual<typeof filters.glob, (field: RunStringFilterField, pattern: string) => RunFilter>, true>()
        );
        return scope.assert.collect();
    }),
    test('exposes field helper signatures', function (scope) {
        scope.assert(sameType<IsEqual<typeof filters.file, (pattern: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.owner, (value: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.params, (value: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.suite, (value: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.tag, (value: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.title, (value: string) => RunFilter>, true>());
        scope.assert(sameType<IsEqual<typeof filters.workload, (value: string) => RunFilter>, true>());
        return scope.assert.collect();
    }),
    test('keeps invalid fields and stability markers out of helper calls', function (scope) {
        scope.assert(sameType<IsAssignable<'kind', RunStringFilterField>, false>());
        scope.assert(sameType<IsAssignable<'runtime', RunStringFilterField>, false>());
        scope.assert(sameType<IsAssignable<'stability', RunStringFilterField>, false>());
        scope.assert(assignableFrom.not<keyof typeof filters, 'kind'>());
        scope.assert(assignableFrom.not<keyof typeof filters, 'stability'>());
        scope.assert(rejectsCall('argument-type'), function () {
            return equalsUnderTest('kind', 'microtest');
        });
        return scope.assert.collect();
    })
]);
