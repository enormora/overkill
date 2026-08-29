import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createCaseId } from '../engine/identity.ts';
import { resolveRootMetadata } from '../engine/metadata.ts';
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
    name,
    not,
    owner,
    params,
    runtime,
    stability,
    suite,
    tag
} from './run-selection-filters.ts';
import type { RunFilter } from './run-types.ts';

const candidate = {
    id: createCaseId('source/Payments/Card.test.ts', [ 'payments', 'card' ], 'Charges Card', 'currency=EUR'),
    metadata: resolveRootMetadata({
        ownership: [ '@Payments' ],
        runtimes: [ 'Node' ],
        stability: 'stable',
        tags: [ 'Fast' ]
    })
};

const anonymousCandidate = {
    id: createCaseId(null, [], 'Anonymous Case', null),
    metadata: resolveRootMetadata({})
};

export const testSuite = createOverkillSuite({
    name: 'source/run/run-selection-filters.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'filter helpers create serializable filter expressions',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    all([ tag('fast'), not(file('source/**')), any([ name('charge'), stability('stable') ]) ]),
                    {
                        filters: [
                            { field: 'tag', kind: 'equals', value: 'fast' },
                            { filter: { field: 'file', kind: 'glob', pattern: 'source/**' }, kind: 'not' },
                            {
                                filters: [
                                    { field: 'name', kind: 'contains', value: 'charge' },
                                    { field: 'stability', kind: 'equals', value: 'stable' }
                                ],
                                kind: 'any'
                            }
                        ],
                        kind: 'all'
                    }
                );
                scope.assert.deepEqual(caseId(candidate.id), { id: candidate.id, kind: 'case-id' });
                scope.assert.deepEqual(params('EUR'), { field: 'params', kind: 'contains', value: 'EUR' });
                scope.assert.deepEqual(runtime('node'), { field: 'runtime', kind: 'equals', value: 'node' });
                scope.assert.deepEqual(owner('@payments'), { field: 'owner', kind: 'equals', value: '@payments' });
                scope.assert.deepEqual(suite('payments'), { field: 'suite', kind: 'contains', value: 'payments' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'matchesRunFilter() matches supported dimensions case-insensitively',
            metadata: {},
            body(scope: OverkillScope) {
                const matchingFilters: readonly RunFilter[] = [
                    caseId(candidate.id),
                    file('source/payments/*.test.ts'),
                    name('charges'),
                    suite('PAYMENTS > CARD'),
                    params('eur'),
                    tag('fast'),
                    runtime('node'),
                    owner('@payments'),
                    stability('stable'),
                    contains('file', 'card.test'),
                    glob('tag', 'fa*')
                ];

                for (const filter of matchingFilters) {
                    scope.assert.equal(matchesRunFilter(filter, candidate), true);
                }

                scope.assert.equal(matchesRunFilter(not(tag('slow')), candidate), true);
                scope.assert.equal(matchesRunFilter(all([ tag('FAST'), runtime('NODE') ]), candidate), true);
                scope.assert.equal(matchesRunFilter(any([ tag('slow'), owner('@PAYMENTS') ]), candidate), true);
                scope.assert.equal(matchesRunFilter(tag('slow'), candidate), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'matchesRunFilter() treats absent identity dimensions as non-matches',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(matchesRunFilter(file('source/**/*.test.ts'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(params('currency'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(suite('payments'), anonymousCandidate), false);
                scope.assert.equal(matchesRunFilter(name('anonymous'), anonymousCandidate), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'copyRunSelection() deep-copies serializable filter trees',
            metadata: {},
            body(scope: OverkillScope) {
                const selection = {
                    filter: all([
                        not(caseId(candidate.id)),
                        glob('file', 'source/**'),
                        any([ tag('fast'), equals('runtime', 'node') ])
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
            name: 'run filter helpers reject empty text operands',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.throws(function createEmptyContainsFilter() {
                    contains('name', ' ');
                }, { message: 'Run filter value must not be empty.' });
                scope.assert.throws(function createEmptyGlobFilter() {
                    glob('file', ' ');
                }, { message: 'Run filter glob pattern must not be empty.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'run filter validation rejects malformed filter trees',
            metadata: {},
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
                    name: 'valid case',
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
                        { filter: { id: { ...validCaseId, name: ' ' }, kind: 'case-id' }, kind: 'filter' },
                        'Run filter case id name must be a non-empty string.'
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
