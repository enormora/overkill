import { suite, test } from '@overkill-dev/test';

import { DryRunStatus, MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { mutationInvocations } from '../../test-support/mutation-invocations.ts';

const dry = { coverageAnalysis: 'off', timeout: 50, disableBail: false } as const;
export const testNode = suite('mutation runner invocation orchestration', [
    test('publishes the first complete dry run as the campaign baseline', async function (scope) {
        const { reply } = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, null, reply);
        const result = await fixture.invocations.dry(fixture.runner, dry, fixture.budget);
        scope.assert.equal(result.status, DryRunStatus.Complete);
        scope.assert.deepEqual(fixture.calls, [ 'fetch', 'publish' ]);
        scope.assert.deepEqual(fixture.admissions, [ 'dry:false' ]);
        scope.assert.equal(fixture.baseline()?.coverageAnalysis, 'off');
        scope.assert.equal(fixture.executions.length, 1);
        return scope.assert.collect();
    }),
    test('reuses a published baseline without republishing it', async function (scope) {
        const coverage = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, coverage.baseline, coverage.reply);
        await fixture.invocations.dry(fixture.runner, dry, fixture.budget);
        await fixture.invocations.dry(fixture.runner, dry, fixture.budget);
        scope.assert.deepEqual(fixture.calls, [ 'fetch' ]);
        scope.assert.equal(fixture.executions.length, 2);
        return scope.assert.collect();
    }),
    test('does not publish a timed out dry run', async function (scope) {
        const fixture = mutationInvocations(scope.cleanup, null, { kind: 'timeout', artifacts: [], data: null });
        const result = await fixture.invocations.dry(fixture.runner, dry, fixture.budget);
        scope.assert.equal(result.status, DryRunStatus.Timeout);
        scope.assert.deepEqual(fixture.calls, [ 'fetch' ]);
        scope.assert.equal(fixture.baseline(), null);
        return scope.assert.collect();
    }),
    test('rejects coverage changes before running a dry invocation', async function (scope) {
        const coverage = mutationCoverageFixture('perTest');
        const fixture = mutationInvocations(scope.cleanup, coverage.baseline, coverage.reply);
        await scope.assert.rejects(async function () {
            await fixture.invocations.dry(fixture.runner, dry, fixture.budget);
        }, { message: 'Dry run conflicts with the original campaign selection or coverage mode.' });
        scope.assert.deepEqual(fixture.executions, []);
        return scope.assert.collect();
    }),
    test(
        'returns timeout before execution when baseline delivery exhausts the budget',
        async function (scope) {
            const fixture = mutationInvocations(scope.cleanup, null, mutationCoverageFixture('off').reply);
            const runner = {
                ...fixture.runner,
                client: {
                    ...fixture
                        .runner
                        .client,
                    async request() {
                        fixture.clock.advanceByMilliseconds(50);
                        return { kind: 'baseline', baseline: null } as const;
                    }
                }
            };
            const result = await fixture.invocations.dry(runner, dry, fixture.budget);
            scope.assert.equal(result.status, DryRunStatus.Timeout);
            scope.assert.deepEqual(fixture.executions, []);
            return scope.assert.collect();
        }
    ),
    test('requires a dry-run baseline before executing a mutant', async function (scope) {
        const coverage = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, null, coverage.reply);
        await scope.assert.rejects(async function () {
            await fixture.invocations.mutant(fixture.runner, coverage.options, fixture.budget);
        }, { message: 'Campaign dry-run baseline is unavailable.' });
        scope.assert.deepEqual(fixture.executions, []);
        return scope.assert.collect();
    }),
    test('runs a runtime mutant against the frozen campaign selection', async function (scope) {
        const coverage = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, coverage.baseline, coverage.reply);
        const result = await fixture.invocations.mutant(fixture.runner, coverage.options, fixture.budget);
        scope.assert.equal(result.status, MutantRunStatus.Survived);
        scope.assert.deepEqual(fixture.admissions, [ 'runtime:false' ]);
        scope.assert.partialDeepEqual<unknown, unknown>(fixture.executions[0], { activeMutant: 'mutant' });
        return scope.assert.collect();
    }),
    test('forwards static activation and environment replacement to execution', async function (scope) {
        const coverage = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, coverage.baseline, coverage.reply);
        await fixture.invocations.mutant(fixture.runner, {
            ...coverage.options,
            mutantActivation: 'static',
            reloadEnvironment: true
        }, fixture.budget);
        scope.assert.deepEqual(fixture.admissions, [ 'static:true' ]);
        return scope.assert.collect();
    }),
    test('returns timeout before mutant execution when baseline delivery is late', async function (scope) {
        const coverage = mutationCoverageFixture('off');
        const fixture = mutationInvocations(scope.cleanup, coverage.baseline, coverage.reply);
        const runner = {
            ...fixture.runner,
            client: {
                ...fixture.runner.client,
                async request() {
                    fixture.clock.advanceByMilliseconds(50);
                    return { kind: 'baseline', baseline: coverage.baseline } as const;
                }
            }
        };
        const result = await fixture.invocations.mutant(runner, coverage.options, fixture.budget);
        scope.assert.equal(result.status, MutantRunStatus.Timeout);
        scope.assert.deepEqual(fixture.executions, []);
        return scope.assert.collect();
    })
]);
