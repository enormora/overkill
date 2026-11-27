import { suite, test } from '@overkill-dev/test-type-authoring';
import { assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type { CaseId } from '../engine/engine.entry-point.ts';
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

export const testNode = suite('@overkill-dev/run/filters', [
    test('exposes the typed filter helper surface without test-family matching', function (typeScope) {
        typeScope.assert(sameType<keyof typeof filters, FilterPackageValueExport>());
        typeScope.assert(
            sameType<RunStringFilterField, 'file' | 'owner' | 'params' | 'suite' | 'tag' | 'title' | 'workload'>()
        );
        return typeScope.assert.collect();
    }),
    test('creates typed filter trees for run selections', function (typeScope) {
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

        typeScope.assert(assignableTo.withActual<RunFilter>(), filter);
        typeScope.assert(assignableFrom<RunSelection, {
            readonly filter: RunFilter;
            readonly kind: 'filter';
        }>());
        return typeScope.assert.collect();
    }),
    test('exposes composite helper signatures', function (typeScope) {
        typeScope.assert(
            sameType<typeof filters.all, (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter>()
        );
        typeScope.assert(
            sameType<typeof filters.any, (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter>()
        );
        typeScope.assert(sameType<typeof filters.not, (filter: RunFilter) => RunFilter>());
        typeScope.assert(sameType<typeof filters.caseId, (id: CaseId) => RunFilter>());
        typeScope.assert(sameType<typeof filters.parseRunFilterExpression, (expression: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.runtime, (name: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.runtimeVariant, (name: string, variantId: string) => RunFilter>());
        typeScope.assert(
            sameType<
                typeof filters.runtimeDimension,
                (name: string, dimensionName: string, value: string) => RunFilter
            >()
        );
        typeScope.assert(
            sameType<typeof filters.runtimeScenario, (runtime: string, scenario: string, value: string) => RunFilter>()
        );
        return typeScope.assert.collect();
    }),
    test('exposes generic string helper signatures', function (typeScope) {
        typeScope.assert(sameType<typeof filters.equals, (field: RunStringFilterField, value: string) => RunFilter>());
        typeScope.assert(
            sameType<typeof filters.contains, (field: RunStringFilterField, value: string) => RunFilter>()
        );
        typeScope.assert(sameType<typeof filters.glob, (field: RunStringFilterField, pattern: string) => RunFilter>());
        return typeScope.assert.collect();
    }),
    test('exposes field helper signatures', function (typeScope) {
        typeScope.assert(sameType<typeof filters.file, (pattern: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.owner, (value: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.params, (value: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.suite, (value: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.tag, (value: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.title, (value: string) => RunFilter>());
        typeScope.assert(sameType<typeof filters.workload, (value: string) => RunFilter>());
        return typeScope.assert.collect();
    }),
    test('keeps invalid fields and stability markers out of helper calls', function (typeScope) {
        typeScope.assert(assignableFrom.not<RunStringFilterField, 'kind'>());
        typeScope.assert(assignableFrom.not<RunStringFilterField, 'runtime'>());
        typeScope.assert(assignableFrom.not<RunStringFilterField, 'stability'>());
        typeScope.assert(assignableFrom.not<keyof typeof filters, 'kind'>());
        typeScope.assert(assignableFrom.not<keyof typeof filters, 'stability'>());
        typeScope.assert(rejectsCall('argument-type'), () => equalsUnderTest('kind', 'microtest'));
        return typeScope.assert.collect();
    })
]);
