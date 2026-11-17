import { runIfMain } from '#test-runner';
import { MutantRunStatus } from '@stryker-mutator/api/test-runner';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { createMutationEvidenceFixture } from '../../test-support/mutation-evidence-fixture.ts';
import { testNode as protocol } from './mutation-baseline-protocol.test.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { interruptedMutantResult, hitLimitCollectionReply } from './mutation-interrupted-result.ts';

export const testNode = suite('interrupted mutation adapter replies', [
    protocol,
    ...[ false, true ].map(function (confirmedKill) {
        return test(
            `requires eligible killing evidence for interrupted bail ${confirmedKill}`,
            async function (scope: TestScope) {
                const fixture = await createMutationEvidenceFixture(scope, false);
                if (confirmedKill) {
                    await fixture.record(fixture.failed, []);
                }
                const data = { ...mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot()), bailed: true };
                const result = interruptedMutantResult('/project', { kind: 'timeout', artifacts: [], data }, {
                    ...fixture.expectation,
                    disableBail: false
                });
                scope.assert.equal(result.status, confirmedKill ? MutantRunStatus.Timeout : MutantRunStatus.Error);
                if (result.status === MutantRunStatus.Error) {
                    scope.assert.includes(
                        result.errorMessage,
                        'Execution stopped without a confirmed eligible failure.'
                    );
                }
                return scope.assert.collect();
            }
        );
    }),
    ...[ 'loader', 'runtime' ].map(function (kind) {
        return test(`only converts empty loader hit-limit failures to timeouts: ${kind}`, function (scope: TestScope) {
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
            scope.assert.deepEqual<unknown, unknown>({ kind: hitLimitCollectionReply(guarded)?.kind ?? null }, {
                kind: kind === 'loader' ? 'timeout' : null
            });
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
