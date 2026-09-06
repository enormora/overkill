import { describe, expect, test } from 'tstyche';
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
    readonly stability: true;
    readonly suite: true;
    readonly tag: true;
    readonly title: true;
};

describe('@overkill-dev/run/filters', function () {
    test('exposes the typed filter helper surface without test-family matching', function () {
        expect<keyof typeof filters>().type.toBe<FilterPackageValueExport>();
        expect<RunStringFilterField>().type.toBe<
            'file' | 'owner' | 'params' | 'runtime' | 'stability' | 'suite' | 'tag' | 'title'
        >();
    });

    test('creates typed filter trees for run selections', function () {
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
            filters.runtime('node'),
            filters.stability('stable'),
            filters.suite('users'),
            filters.params('primary'),
            filters.caseId(id)
        ]);

        expect(filter).type.toBeAssignableTo<RunFilter>();
        expect<RunSelection>().type.toBeAssignableFrom<{
            readonly filter: RunFilter;
            readonly kind: 'filter';
        }>();
    });

    test('exposes composite helper signatures', function () {
        expect<typeof filters.all>().type.toBe<
            (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter
        >();
        expect<typeof filters.any>().type.toBe<
            (filters: readonly [RunFilter, ...(readonly RunFilter[])]) => RunFilter
        >();
        expect<typeof filters.not>().type.toBe<(filter: RunFilter) => RunFilter>();
        expect<typeof filters.caseId>().type.toBe<(id: CaseId) => RunFilter>();
        expect<typeof filters.parseRunFilterExpression>().type.toBe<(expression: string) => RunFilter>();
    });

    test('exposes generic string helper signatures', function () {
        expect<typeof filters.equals>().type.toBe<(field: RunStringFilterField, value: string) => RunFilter>();
        expect<typeof filters.contains>().type.toBe<(field: RunStringFilterField, value: string) => RunFilter>();
        expect<typeof filters.glob>().type.toBe<(field: RunStringFilterField, pattern: string) => RunFilter>();
    });

    test('exposes field helper signatures', function () {
        expect<typeof filters.file>().type.toBe<(pattern: string) => RunFilter>();
        expect<typeof filters.owner>().type.toBe<(value: string) => RunFilter>();
        expect<typeof filters.params>().type.toBe<(value: string) => RunFilter>();
        expect<typeof filters.runtime>().type.toBe<(value: string) => RunFilter>();
        expect<typeof filters.stability>().type.toBe<(value: 'experimental' | 'flaky' | 'stable') => RunFilter>();
        expect<typeof filters.suite>().type.toBe<(value: string) => RunFilter>();
        expect<typeof filters.tag>().type.toBe<(value: string) => RunFilter>();
        expect<typeof filters.title>().type.toBe<(value: string) => RunFilter>();
    });

    test('keeps invalid fields and stability markers out of helper calls', function () {
        expect<RunStringFilterField>().type.not.toBeAssignableFrom<'kind'>();
        expect<keyof typeof filters>().type.not.toBeAssignableFrom<'kind'>();
        expect<typeof filters.stability>().type.not.toBeCallableWith('quarantined');
        expect<typeof filters.equals>().type.not.toBeCallableWith('kind', 'microtest');
    });
});
