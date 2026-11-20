import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import { resolveRootTestAnnotations } from '../engine/test-data.ts';
import {
    all,
    any,
    caseId,
    contains,
    copyRunSelection,
    equals,
    file,
    glob,
    invalidRunSelectionMessage,
    matchesRunFilter,
    not,
    owner,
    params,
    runtime,
    runtimeDimension,
    runtimeScenario,
    runtimeVariant,
    suite as subjectSuite,
    tag,
    title
} from './run-selection-filters.ts';
import type { RunFilter } from './run-request-types.ts';

const candidate = {
    annotations: resolveRootTestAnnotations({
        ownership: [ '@Payments' ],
        tags: [ 'Fast' ]
    }),
    id: createCaseId('source/Payments/Card.test.ts', [ 'payments', 'card' ], 'Charges Card', 'currency=EUR'),
    workId: {
        familyVariant: null,
        case: createCaseId('source/Payments/Card.test.ts', [ 'payments', 'card' ], 'Charges Card', 'currency=EUR'),
        runtimes: [
            {
                dimensions: {},
                name: 'api',
                scenarios: { api: 'payments-500' },
                variantId: null
            },
            {
                dimensions: { engine: 'chromium', headless: 'true' },
                name: 'browser',
                scenarios: {},
                variantId: 'chromium'
            }
        ],
        workload: null
    }
};

const anonymousCaseId = createCaseId(null, [], 'Anonymous Case', null);
const anonymousCandidate = {
    annotations: resolveRootTestAnnotations({}),
    id: anonymousCaseId,
    workId: createDefaultWorkId(anonymousCaseId)
};

function assertRuntimeScenarioMatches(scope: TestScope): void {
    scope.assert.equal(matchesRunFilter(runtimeScenario('api', 'api', 'payments-500'), candidate), true);
    scope.assert.equal(matchesRunFilter(runtimeScenario('API', 'api', 'payments-500'), candidate), false);
    scope.assert.equal(matchesRunFilter(runtimeScenario('api', 'api', 'PAYMENTS-500'), candidate), false);
    scope.assert.equal(matchesRunFilter(runtimeScenario('api', 'missing', 'payments-500'), candidate), false);
}

function assertRuntimeIdentityMatches(scope: TestScope): void {
    scope.assert.equal(matchesRunFilter(runtime('browser'), candidate), true);
    scope.assert.equal(matchesRunFilter(runtime('Browser'), candidate), false);
    scope.assert.equal(matchesRunFilter(runtimeVariant('browser', 'chromium'), candidate), true);
    scope.assert.equal(matchesRunFilter(runtimeVariant('browser', 'Chromium'), candidate), false);
    scope.assert.equal(matchesRunFilter(runtimeDimension('browser', 'engine', 'chromium'), candidate), true);
    scope.assert.equal(matchesRunFilter(runtimeDimension('browser', 'engine', 'Chromium'), candidate), false);
    scope.assert.equal(matchesRunFilter(runtimeDimension('browser', 'missing', 'value'), candidate), false);
}

function assertCompositeFiltersMatch(scope: TestScope): void {
    scope.assert.equal(matchesRunFilter(not(tag('slow')), candidate), true);
    scope.assert.equal(matchesRunFilter(all([ tag('FAST'), owner('@PAYMENTS') ]), candidate), true);
    scope.assert.equal(matchesRunFilter(any([ tag('slow'), owner('@PAYMENTS') ]), candidate), true);
    scope.assert.equal(matchesRunFilter(tag('slow'), candidate), false);
}

export const testNode: TestNode = suite('Run selection filters', [
    test(
        'work identity selections validate and match complete default work identities',
        function (scope) {
            const workId = createDefaultWorkId(candidate.id);
            const filter = { kind: 'work-id' as const, id: workId };
            scope.assert.equal(invalidRunSelectionMessage({ kind: 'filter', filter }), null);
            scope.assert.true(matchesRunFilter(filter, { ...candidate, workId }));
            return scope.assert.collect();
        }
    ),
    test('workload filters exclude cases without a workload identity', function (scope) {
        scope.assert.false(matchesRunFilter(equals('workload', 'small'), {
            ...candidate,
            workId: { ...candidate.workId, workload: null }
        }));
        return scope.assert.collect();
    }),
    test('work identity filters preserve exact runtime and workload bindings', function (scope) {
        const filter = { kind: 'work-id', id: candidate.workId } as const;
        const selection = { kind: 'filter', filter } as const;
        scope.assert.deepEqual(copyRunSelection(selection), selection);
        scope.assert.equal(matchesRunFilter(filter, candidate), true);
        scope.assert.equal(
            matchesRunFilter(filter, {
                ...candidate,
                workId: { ...candidate.workId, runtimes: [] }
            }),
            false
        );
        const workloadCandidate = {
            ...candidate,
            workId: {
                ...candidate.workId,
                workload: { name: 'load', params: { clients: '4' } }
            }
        };
        scope.assert.equal(matchesRunFilter(filter, workloadCandidate), false);
        scope.assert.equal(matchesRunFilter(equals('workload', 'load'), workloadCandidate), true);
        scope.assert.equal(
            invalidRunSelectionMessage({
                kind: 'filter',
                filter: { kind: 'work-id', id: null }
            }),
            'Run filter work id is invalid.'
        );
        return scope.assert.collect();
    }),
    test('filter helpers create serializable filter expressions', function (scope) {
        scope.assert.deepEqual(
            all([ tag('fast'), not(file('source/**')), any([ title('charge'), owner('@payments') ]) ]),
            {
                filters: [
                    { field: 'tag', kind: 'equals', value: 'fast' },
                    { filter: { field: 'file', kind: 'glob', pattern: 'source/**' }, kind: 'not' },
                    {
                        filters: [
                            { field: 'title', kind: 'contains', value: 'charge' },
                            { field: 'owner', kind: 'equals', value: '@payments' }
                        ],
                        kind: 'any'
                    }
                ],
                kind: 'all'
            }
        );
        scope.assert.deepEqual(caseId(candidate.id), { id: candidate.id, kind: 'case-id' });
        scope.assert.deepEqual(params('EUR'), { field: 'params', kind: 'contains', value: 'EUR' });
        scope.assert.deepEqual(owner('@payments'), { field: 'owner', kind: 'equals', value: '@payments' });
        scope.assert.deepEqual(subjectSuite('payments'), { field: 'suite', kind: 'contains', value: 'payments' });
        scope.assert.deepEqual(runtimeScenario('api', 'api', 'payments-500'), {
            kind: 'runtime-scenario',
            runtime: 'api',
            scenario: 'api',
            value: 'payments-500'
        });
        scope.assert.deepEqual(runtime('browser'), {
            kind: 'runtime',
            runtime: 'browser'
        });
        scope.assert.deepEqual(runtimeVariant('browser', 'chromium'), {
            kind: 'runtime-variant',
            runtime: 'browser',
            variantId: 'chromium'
        });
        scope.assert.deepEqual(runtimeDimension('browser', 'engine', 'chromium'), {
            dimension: 'engine',
            kind: 'runtime-dimension',
            runtime: 'browser',
            value: 'chromium'
        });

        return scope.assert.collect();
    }),
    test('matchesRunFilter() matches supported dimensions case-insensitively', function (scope) {
        const matchingFilters: readonly RunFilter[] = [
            caseId(candidate.id),
            file('source/payments/*.test.ts'),
            title('charges'),
            subjectSuite('PAYMENTS > CARD'),
            params('eur'),
            tag('fast'),
            owner('@payments'),
            contains('file', 'card.test'),
            glob('tag', 'fa*')
        ];

        for (const filter of matchingFilters) {
            scope.assert.equal(matchesRunFilter(filter, candidate), true);
        }

        assertCompositeFiltersMatch(scope);
        assertRuntimeScenarioMatches(scope);
        assertRuntimeIdentityMatches(scope);
        scope.assert.equal(matchesRunFilter({ kind: 'unknown' } as unknown as RunFilter, candidate), false);

        return scope.assert.collect();
    }),
    test('matchesRunFilter() treats absent identity dimensions as non-matches', function (scope) {
        scope.assert.equal(matchesRunFilter(file('source/**/*.test.ts'), anonymousCandidate), false);
        scope.assert.equal(matchesRunFilter(params('currency'), anonymousCandidate), false);
        scope.assert.equal(matchesRunFilter(subjectSuite('payments'), anonymousCandidate), false);
        scope.assert.equal(matchesRunFilter(title('anonymous'), anonymousCandidate), true);

        return scope.assert.collect();
    }),
    test('copyRunSelection() deep-copies serializable filter trees', function (scope) {
        const selection = {
            filter: all([
                not(caseId(candidate.id)),
                glob('file', 'source/**'),
                runtime('browser'),
                runtimeVariant('browser', 'chromium'),
                runtimeDimension('browser', 'engine', 'chromium'),
                runtimeScenario('api', 'api', 'payments-500'),
                any([ tag('fast'), equals('owner', '@payments') ])
            ]),
            kind: 'filter' as const
        };
        const copy = copyRunSelection(selection);

        scope.assert.deepEqual(copy, selection);
        scope.assert.notEqual(copy, selection);
        if (copy.kind === 'filter') {
            scope.assert.notEqual(copy.filter, selection.filter);
        }
        scope.assert.deepEqual(copyRunSelection({ kind: 'all' }), { kind: 'all' });

        return scope.assert.collect();
    }),
    test('run filter helpers reject empty text operands', function (scope) {
        scope.assert.throws(function createEmptyContainsFilter() {
            contains('title', ' ');
        }, { message: 'Run filter value must not be empty.' });
        scope.assert.throws(function createEmptyGlobFilter() {
            glob('file', ' ');
        }, { message: 'Run filter glob pattern must not be empty.' });
        scope.assert.throws(function createEmptyRuntimeScenarioFilter() {
            runtimeScenario('api', ' ', 'default');
        }, { message: 'Runtime scenario filter scenario must not be empty.' });
        scope.assert.throws(function createRuntimeScenarioFilterWithEmptyRuntime() {
            runtimeScenario(' ', 'api', 'default');
        }, { message: 'Runtime scenario filter runtime must not be empty.' });
        scope.assert.throws(function createRuntimeScenarioFilterWithEmptyValue() {
            runtimeScenario('api', 'api', ' ');
        }, { message: 'Runtime scenario filter value must not be empty.' });
        scope.assert.throws(function createEmptyRuntimeFilter() {
            runtime(' ');
        }, { message: 'Runtime filter name must not be empty.' });
        scope.assert.throws(function createRuntimeVariantFilterWithEmptyVariant() {
            runtimeVariant('browser', ' ');
        }, { message: 'Runtime variant filter variant id must not be empty.' });
        scope.assert.throws(function createRuntimeDimensionFilterWithEmptyDimension() {
            runtimeDimension('browser', ' ', 'chromium');
        }, { message: 'Runtime dimension filter dimension must not be empty.' });

        return scope.assert.collect();
    }),
    test('run filter validation rejects malformed filter trees', function (scope) {
        scope.assert.throws(function createEmptyComposite() {
            all([] as unknown as readonly [RunFilter, ...RunFilter[]]);
        }, { message: 'Composite run filters must contain at least one child filter.' });
        scope.assert.equal(
            invalidRunSelectionMessage({
                filter: { field: 'kind', kind: 'equals', value: 'microtest' },
                kind: 'filter'
            }),
            'Run filter field is unknown.'
        );
        scope.assert.equal(
            invalidRunSelectionMessage({ filter: { field: 'tag', kind: 'equals', value: '' }, kind: 'filter' }),
            'Run filter value must be a non-empty string.'
        );
        const validCaseId = {
            file: 'source/example.test.ts',
            title: 'valid case',
            params: null,
            suite: [ 'suite' ]
        };
        const malformedSelections: readonly (readonly [unknown, string | null])[] = [
            [ null, 'Run selection must be an object.' ],
            [ { kind: 'selected' }, 'Run selection kind is unknown.' ],
            [ { kind: 'all' }, null ],
            [ { filter: null, kind: 'filter' }, 'Run filter must be an object.' ],
            [ { filter: { kind: 'selected' }, kind: 'filter' }, 'Run filter kind is unknown.' ],
            [ { filter: { kind: 1 }, kind: 'filter' }, 'Run filter kind is unknown.' ],
            [
                { filter: { filters: [], kind: 'any' }, kind: 'filter' },
                'Composite run filters must contain at least one child filter.'
            ],
            [
                {
                    filter: {
                        filter: { field: 'tag', kind: 'equals', value: 'fast' },
                        kind: 'not'
                    },
                    kind: 'filter'
                },
                null
            ],
            [ { filter: { filter: null, kind: 'not' }, kind: 'filter' }, 'Run filter must be an object.' ],
            [
                {
                    filter: {
                        filters: [ { field: 'tag', kind: 'equals', value: 'fast' }, null ],
                        kind: 'all'
                    },
                    kind: 'filter'
                },
                'Run filter must be an object.'
            ],
            [
                { filter: { id: null, kind: 'case-id' }, kind: 'filter' },
                'Run filter case id must be an object.'
            ],
            [
                { filter: { id: { ...validCaseId, file: 1 }, kind: 'case-id' }, kind: 'filter' },
                'Run filter case id file must be a string or null.'
            ],
            [
                { filter: { id: { ...validCaseId, title: ' ' }, kind: 'case-id' }, kind: 'filter' },
                'Run filter case id title must be a non-empty string.'
            ],
            [
                { filter: { id: { ...validCaseId, params: 1 }, kind: 'case-id' }, kind: 'filter' },
                'Run filter case id params must be a string or null.'
            ],
            [
                { filter: { id: { ...validCaseId, suite: [ '' ] }, kind: 'case-id' }, kind: 'filter' },
                'Run filter case id suite must contain non-empty strings.'
            ],
            [
                { filter: { field: 'file', kind: 'glob', pattern: '' }, kind: 'filter' },
                'Run filter pattern must be a non-empty string.'
            ],
            [
                { filter: { field: 1, kind: 'equals', value: 'fast' }, kind: 'filter' },
                'Run filter field is unknown.'
            ],
            [
                {
                    filter: { kind: 'runtime', runtime: '' },
                    kind: 'filter'
                },
                'Runtime filter runtime must be a non-empty string.'
            ],
            [
                {
                    filter: {
                        kind: 'runtime-variant',
                        runtime: 'browser',
                        variantId: ''
                    },
                    kind: 'filter'
                },
                'Runtime variant filter variantId must be a non-empty string.'
            ],
            [
                {
                    filter: {
                        dimension: '',
                        kind: 'runtime-dimension',
                        runtime: 'browser',
                        value: 'chromium'
                    },
                    kind: 'filter'
                },
                'Runtime dimension filter dimension must be a non-empty string.'
            ],
            [
                {
                    filter: { kind: 'runtime-scenario', runtime: 1, scenario: 'api', value: 'default' },
                    kind: 'filter'
                },
                'Runtime scenario filter runtime must be a non-empty string.'
            ],
            [
                {
                    filter: { kind: 'runtime-scenario', runtime: 'api', scenario: '', value: 'default' },
                    kind: 'filter'
                },
                'Runtime scenario filter scenario must be a non-empty string.'
            ],
            [
                {
                    filter: { kind: 'runtime-scenario', runtime: 'api', scenario: 'api', value: '' },
                    kind: 'filter'
                },
                'Runtime scenario filter value must be a non-empty string.'
            ],
            [
                {
                    filter: {
                        kind: 'runtime-scenario',
                        runtime: 'api',
                        scenario: 'api',
                        value: 'default'
                    },
                    kind: 'filter'
                },
                null
            ]
        ];

        for (const [ selection, message ] of malformedSelections) {
            scope.assert.equal(invalidRunSelectionMessage(selection), message);
        }

        return scope.assert.collect();
    })
]);
