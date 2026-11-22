import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import type { RunResult } from '../../../engine/run-result.ts';
import { sessionFixture } from '../../../test-support/baseline-publication-fixture.ts';
import type { OrdinaryBaselineEntry } from '../../../run/baseline-record.ts';
import { createOrdinaryBaselineSession } from '../../../run/baseline-session.ts';
import { readOrdinaryBaselineReport } from '../../../run/baseline-report.ts';

const assertBlockedPublication = defineCompositeAssertion({
    name: 'blocked publication',
    assert(
        check,
        result: RunResult,
        entries: readonly OrdinaryBaselineEntry[],
        original: readonly OrdinaryBaselineEntry[]
    ) {
        return check.group([
            check.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'blocked'),
            check.equal(result.runnerErrors[0]?.subtype, 'artifact'),
            check.deepEqual(entries, original)
        ]);
    }
});
const partialPublicationEvidence = defineCompositeAssertion({
    name: 'retains completed writes after a later I/O failure',
    assert(check, result: RunResult) {
        const report = readOrdinaryBaselineReport(result);
        return check.group([
            check.equal(result.status, 'failed'),
            check.equal(result.runnerErrors[0]?.subtype, 'artifact'),
            check.equal(report?.writeOutcome.kind, 'failed'),
            check.equal(report?.writeOutcome.kind === 'failed' ? report.writeOutcome.writtenChanges.length : null, 1)
        ]);
    }
});
export const testNode = suite('ordinary baseline publication', [
    test('retains completed writes after a later I/O failure', async function (scope) {
        const fixture = await sessionFixture(scope.cleanup);
        const session = createOrdinaryBaselineSession({
            maxBytes: 65_536,
            mode: 'update',
            dispatcher: fixture.dispatcher,
            workflow: {
                changes: fixture.changes,
                warnings: [],
                prepareResult(result) {
                    return result;
                },
                finish(result) {
                    return result;
                },
                async evaluate() {
                    throw new Error('Unexpected evaluation.');
                },
                store: {
                    ...fixture.store,
                    async publish(changes) {
                        const [ first ] = changes;
                        if (first === undefined) {
                            throw new Error('Missing publication fixture.');
                        }
                        await fixture.store.apply(first);
                        return {
                            outcome: { kind: 'failed', writtenChanges: [ first ] },
                            errors: [ new Error('Publication failed.') ]
                        };
                    }
                }
            }
        });
        const result = await session.finalize(fixture.result);

        scope.assert(partialPublicationEvidence, result);

        const entries = await fixture.store.list();
        scope.assert.deepEqual(
            entries.map(function identity(entry) {
                return entry.baseline.work.case.title;
            }),
            [ 'first' ]
        );
        return scope.assert.collect();
    }),
    test('validates the whole batch before publishing its first change', async function (scope: TestScope) {
        const fixture = await sessionFixture(scope.cleanup);
        const [ , second ] = fixture.changes;
        scope.require.defined(second);
        await fixture.store.apply(second);
        const original = await fixture.store.list();
        const session = createOrdinaryBaselineSession({
            maxBytes: 65_536,
            mode: 'apply',
            dispatcher: fixture.dispatcher,
            workflow: {
                changes: fixture.changes,
                warnings: [],
                store: fixture.store,
                prepareResult(result) {
                    return result;
                },
                finish(result) {
                    return result;
                },
                async evaluate() {
                    throw new Error('Unexpected evaluation.');
                }
            }
        });
        const result = await session.finalize(fixture.result);
        scope.assert(assertBlockedPublication, result, await fixture.store.list(), original);
        return scope.assert.collect();
    })
]);
