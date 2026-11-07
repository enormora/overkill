import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import type { RunResult } from '../engine/run-result.ts';
import { sessionFixture } from '../test-support/baseline-publication-fixture.ts';
import type { OrdinaryBaselineEntry } from './baseline-record.ts';
import { createOrdinaryBaselineSession } from './baseline-session.ts';
import { readOrdinaryBaselineReport } from './baseline-report.ts';

function assertPartialPublication(scope: TestScope, result: RunResult): void {
    const report = readOrdinaryBaselineReport(result);
    scope.require.defined(report);
    scope.assert.equal(result.status, 'failed');
    scope.assert.equal(result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.equal(report.writeOutcome.kind, 'failed');
    if (report.writeOutcome.kind === 'failed') {
        scope.assert.equal(report.writeOutcome.writtenChanges.length, 1);
    }
}
function assertBlockedPublication(
    scope: TestScope,
    result: RunResult,
    entries: readonly OrdinaryBaselineEntry[],
    original: readonly OrdinaryBaselineEntry[]
): void {
    scope.assert.equal(readOrdinaryBaselineReport(result)?.writeOutcome.kind, 'blocked');
    scope.assert.equal(result.runnerErrors[0]?.subtype, 'artifact');
    scope.assert.deepEqual(entries, original);
}
export const testNode = suite('ordinary baseline publication', [
    test('retains completed writes after a later I/O failure', async function (scope: TestScope) {
        const fixture = await sessionFixture(scope);
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
        assertPartialPublication(scope, result);
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
        const fixture = await sessionFixture(scope);
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
        assertBlockedPublication(scope, result, await fixture.store.list(), original);
        return scope.assert.collect();
    })
]);
