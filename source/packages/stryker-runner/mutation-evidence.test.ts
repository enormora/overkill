import { MutantRunStatus, type MutantRunResult } from '@stryker-mutator/api/test-runner';
import type { JsonValue } from 'type-fest';
import { suite, test } from '../test/test.entry-point.ts';
import { workIdentityKey, type RunnerError } from '../run/run.entry-point.ts';
import { createMutationEvidenceFixture } from '../../test-support/mutation-evidence-fixture.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutantExecutionResult } from './mutation-results.ts';

const root = '/project';

function diagnostic(result: Readonly<MutantRunResult>): string {
    if (result.status === MutantRunStatus.Error) {
        return result.errorMessage;
    }
    if (result.status === MutantRunStatus.Timeout) {
        return result.reason ?? '';
    }
    throw new Error(`Expected error or timeout, received ${result.status}.`);
}

export const testNode = suite('mutation failure evidence', [
    ...[ 'failure', 'timeout' ].map(function interrupted(kind) {
        return test(`retains completed case failures in a ${kind} reply`, async function (scope) {
            const fixture = await createMutationEvidenceFixture(scope, false);
            await fixture.record(fixture.failed, []);
            const data = fixture.lifecycle.snapshot();
            await fixture.lifecycle.dispose();
            const translated = mutantExecutionResult(
                root,
                kind === 'timeout' ? { kind, data, artifacts: [] } : {
                    artifacts: [],
                    kind: 'failure',
                    data,
                    failure: {
                        kind: 'error',
                        name: 'Error',
                        message: 'disposal sentinel',
                        cause: null,
                        stack: null
                    }
                },
                fixture.expectation
            );
            scope.assert.equal(translated.status, kind === 'timeout' ? 'timeout' : 'error');
            scope.assert.true(diagnostic(translated).includes(workIdentityKey(fixture.first.workId)));
            scope.assert.match(diagnostic(translated), /body-error sentinel/u);
            scope.assert.match(
                diagnostic(translated),
                kind === 'failure' ? /^disposal sentinel/u : /^Mutant invocation/u
            );
            return scope.assert.collect();
        });
    }),
    test('retains claimed policy errors across cumulative serial completions', async function (scope) {
        const fixture = await createMutationEvidenceFixture(scope, false);
        const error: RunnerError = {
            subtype: 'runtime-policy',
            message: 'policy sentinel',
            diagnostics: [],
            cause: { phase: 'body' },
            attributedTo: fixture.first.id,
            attributedToWork: fixture.first.workId,
            attributedToAttempt: { index: 0 }
        };
        for (const result of fixture.passing) {
            await fixture.record(result, [ error ]);
        }
        const snapshot = mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot());
        scope.assert.deepEqual(snapshot.infrastructureErrors, []);
        scope.assert.deepEqual(
            snapshot.caseFailures.map(function classification(failure) {
                return { id: failure.id, kind: failure.kind };
            }),
            [ { id: workIdentityKey(fixture.first.workId), kind: 'killed' } ]
        );
        scope.assert.true(snapshot.caseFailures[0]?.message.includes('policy sentinel') === true);
        return scope.assert.collect();
    }),
    test('resets failure evidence for each invocation without changing earlier snapshots', async function (scope) {
        const fixture = await createMutationEvidenceFixture(scope, false);
        await fixture.record(fixture.failed, []);
        const previous = mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot());
        await fixture.lifecycle.dispose();
        const next = await createMutationEvidenceFixture(scope, false);
        const reset = mutationLifecycleDataSchema.parse(next.lifecycle.snapshot());
        scope.assert.deepEqual({ failures: reset.caseFailures, errors: reset.infrastructureErrors }, {
            failures: [],
            errors: []
        });
        scope.assert.equal(previous.caseFailures.length, 1);
        return scope.assert.collect();
    }),
    ...[ 'cleanup', 'infrastructure' ].map(function errorKind(kind) {
        return test(`keeps recorded ${kind} errors ahead of an interrupted timeout`, async function (scope) {
            const fixture = await createMutationEvidenceFixture(scope, false);
            const { runnerErrors } = runResultFactory.build({
                runnerErrors: [ { subtype: 'reporter', message: 'delivery sentinel' } ]
            });
            await fixture.record(
                kind === 'infrastructure' ? fixture.first : fixture.cleanupFailed,
                kind === 'infrastructure' ? runnerErrors : []
            );
            const translated = mutantExecutionResult(
                root,
                { artifacts: [], kind: 'timeout', data: fixture.lifecycle.snapshot() },
                fixture.expectation
            );
            scope.assert.equal(translated.status, 'error');
            scope.assert.match(
                diagnostic(translated),
                kind === 'infrastructure' ? /delivery sentinel/u : /cleanup-error sentinel/u
            );
            return scope.assert.collect();
        });
    }),
    test('rejects malformed and unowned snapshot evidence without claiming timeout', async function (scope) {
        const fixture = await createMutationEvidenceFixture(scope, false);
        const data = mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot());
        const id = workIdentityKey(fixture.first.workId);
        const failure = { id, kind: 'killed', message: 'case sentinel' } as const;
        const invalid: readonly JsonValue[] = [
            {},
            { ...data, bailed: true },
            { ...data, caseFailures: [ failure ] },
            { ...data, completed: [ id ], caseFailures: [ failure, failure ] },
            { ...data, completed: [ id, id ] },
            { ...data, completed: [ 'unknown' ], caseFailures: [ { ...failure, id: 'unknown' } ] },
            { ...data, completed: [ id ], caseFailures: [ { ...failure, kind: 'pass' } ] }
        ];
        for (const supplied of invalid) {
            scope.assert.equal(
                mutantExecutionResult(root, { artifacts: [], kind: 'timeout', data: supplied }, fixture.expectation)
                    .status,
                'error'
            );
        }
        scope.assert.equal(
            mutantExecutionResult(root, { artifacts: [], kind: 'timeout', data: null }, fixture.expectation).status,
            'timeout'
        );
        return scope.assert.collect();
    }),
    test('requires a confirmed kill when a timeout snapshot reports an allowed bail', async function (scope) {
        const fixture = await createMutationEvidenceFixture(scope, false);
        await fixture.record(fixture.failed, []);
        const data = { ...mutationLifecycleDataSchema.parse(fixture.lifecycle.snapshot()), bailed: true };
        const expectation = { ...fixture.expectation, disableBail: false };
        scope.assert.equal(
            mutantExecutionResult(root, { artifacts: [], kind: 'timeout', data }, expectation).status,
            'timeout'
        );
        scope.assert.equal(
            mutantExecutionResult(
                root,
                { artifacts: [], kind: 'timeout', data: { ...data, caseFailures: [] } },
                expectation
            )
                .status,
            'error'
        );
        return scope.assert.collect();
    })
]);
