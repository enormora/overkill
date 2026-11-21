import { table, suite } from '@overkill-dev/test';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { createMutationEvidenceFixture } from '../../test-support/mutation-evidence-fixture.ts';

import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { interruptedMutantResult, hitLimitCollectionReply } from './mutation-interrupted-result.ts';

export const testNode = suite('interrupted mutation adapter replies', [
    table({
        title: 'requires eligible killing evidence for interrupted bail',
        cases: [ false, true ],
        caseTitle: String,
        async test(scope) {
            const confirmedKill = scope.parameters;

            const fixture = await createMutationEvidenceFixture(scope.cleanup, false);
            if (confirmedKill) {
                await fixture.record(fixture.failed, []);
            }
            const data = { ...mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot()), bailed: true };
            const result = interruptedMutantResult('/project', { kind: 'timeout', artifacts: [], data }, {
                ...fixture.expectation,
                disableBail: false
            }, mutationLifecycleDataSchema.safeParse(data));
            scope.assert.equal(result.status, confirmedKill ? MutantRunStatus.Timeout : MutantRunStatus.Error);
            if (result.status === MutantRunStatus.Error) {
                scope.assert.includes(
                    result.errorMessage,
                    'Execution stopped without a confirmed eligible failure.'
                );
            }
            return scope.assert.collect();
        }
    }),
    table({
        title: 'converts only empty loader hit-limit failures to timeouts',
        cases: [ 'loader', 'runtime' ],
        caseTitle(kind) {
            return kind;
        },
        test(scope) {
            const kind = scope.parameters;

            const { reply } = mutationCoverageFixture('off');
            const data = { ...mutationLifecycleDataSchema.parse(reply.data), hitLimitExceeded: true };
            const guarded = {
                ...reply,
                data,
                result: {
                    ...reply.result,
                    perTest: [],
                    runnerErrors: [ {
                        subtype: kind === 'loader' ? 'loader' as const : 'runtime-policy' as const,
                        attributedTo: null,
                        attributedToWork: null,
                        attributedToAttempt: null,
                        cause: new Error('Stryker: Hit count limit reached (1)'),
                        message: 'guard',
                        diagnostics: []
                    } ]
                }
            };
            scope.assert.deepEqual<unknown, unknown>({ kind: hitLimitCollectionReply(guarded, data)?.kind ?? null }, {
                kind: kind === 'loader' ? 'timeout' : null
            });
            return scope.assert.collect();
        }
    })
]);
