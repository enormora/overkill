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

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
