import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createCaseId } from '../engine/identity.ts';
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
    suite,
    tag,
    title
} from './run-selection-filters.ts';
import type { RunFilter } from './run-types.ts';

const candidate = {
    annotations: resolveRootTestAnnotations({
        ownership: [ '@Payments' ],
        tags: [ 'Fast' ]
    }),
    id: createCaseId('source/Payments/Card.test.ts', [ 'payments', 'card' ], 'Charges Card', 'currency=EUR')
};

const anonymousCandidate = {
    annotations: resolveRootTestAnnotations({}),
    id: createCaseId(null, [], 'Anonymous Case', null)
};

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-selection-filters.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'filter helpers create serializable filter expressions',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
                scope.assert.deepEqual(suite('payments'), { field: 'suite', kind: 'contains', value: 'payments' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'matchesRunFilter() matches supported dimensions case-insensitively',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const matchingFilters: readonly RunFilter[] = [
                    caseId(candidate.id),
                    file('source/payments/*.test.ts'),
                    title('charges'),
                    suite('PAYMENTS > CARD'),
                    params('eur'),
                    tag('fast'),
                    owner('@payments'),
                    contains('file', 'card.test'),
                    glob('tag', 'fa*')
                ];

                for (const filter of matchingFilters) {
                    scope.assert.equal(matchesRunFilter(filter, candidate), true);
                }

                scope.assert.equal(matchesRunFilter(not(tag('slow')), candidate), true);
                scope.assert.equal(matchesRunFilter(all([ tag('FAST'), owner('@PAYMENTS') ]), candidate), true);
                scope.assert.equal(matchesRunFilter(any([ tag('slow'), owner('@PAYMENTS') ]), candidate), true);
                scope.assert.equal(matchesRunFilter(tag('slow'), candidate), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'matchesRunFilter() treats absent identity dimensions as non-matches',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.equal(matchesRunFilter(file('source/**/*.test.ts'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(params('currency'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(suite('payments'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(title('anonymous'), anonymousCandidate), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'copyRunSelection() deep-copies serializable filter trees',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const selection = {
                    filter: all([
                        not(caseId(candidate.id)),
                        glob('file', 'source/**'),
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run filter helpers reject empty text operands',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createEmptyContainsFilter() {
                    contains('title', ' ');
                }, { message: 'Run filter value must not be empty.' });
                scope.assert.throws(function createEmptyGlobFilter() {
                    glob('file', ' ');
                }, { message: 'Run filter glob pattern must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'run filter validation rejects malformed filter trees',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
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
                    [
                        { filter: { filters: [], kind: 'any' }, kind: 'filter' },
                        'Composite run filters must contain at least one child filter.'
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
                    ]
                ];

                for (const [ selection, message ] of malformedSelections) {
                    scope.assert.equal(invalidRunSelectionMessage(selection), message);
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
