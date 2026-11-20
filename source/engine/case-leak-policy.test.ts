import { type TestScope, test, suite as authoredSuite } from '@overkill-dev/test';

import { observationCase } from '../test-support/observation-lifetime.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDisabledAsyncLeakMonitor } from './async-leak-diagnostics.ts';
import { caseWithAsyncLeakPolicy, completeCaseWithAsyncLeakPolicy } from './execution-async-leak-policy.ts';
import type { TestOutcome } from './run-result.ts';

const contractOutcome: TestOutcome = {
    kind: 'fail',
    failures: [ {
        kind: 'test-contract',
        code: 'pending-in-flight-task',
        actual: null,
        expected: 'observed task',
        summary: 'task pending'
    } ]
};
const outcomes: readonly (TestOutcome | null)[] = [ null, { kind: 'pass' }, contractOutcome ];
export const testNode = authoredSuite('case leak attribution policy', [
    ...outcomes.flatMap(function (outcome) {
        return [ false, true ].flatMap(function (includeActiveResourceLeaks) {
            return [ false, true ].map(function (ambiguous) {
                const leaked = outcome !== null && includeActiveResourceLeaks;
                const caseOwned = leaked && !ambiguous;
                return test(
                    `handles ${
                        outcome?.kind ?? 'terminal'
                    } with resource checks ${includeActiveResourceLeaks} and ambiguous ownership ${ambiguous}`,
                    async function (scope: TestScope) {
                        const testCase = observationCase();
                        const original = runResultFactory.build({ perTest: [ {} ] }).perTest[0];
                        scope.require.defined(original);
                        const executedCase = {
                            result: { ...original, outcome },
                            runnerErrors: [],
                            durationMicroseconds: 1
                        };
                        const result = await caseWithAsyncLeakPolicy({
                            testCase,
                            executedCase,
                            includeActiveResourceLeaks,
                            readResourceBaseline() {
                                return [];
                            },
                            ambiguousResources() {
                                return ambiguous ? [ 'UnitResource' ] : [];
                            },
                            dependencies: {
                                asyncLeakMonitor: createDisabledAsyncLeakMonitor(),
                                readActiveResourceTypes() {
                                    return [ 'UnitResource' ];
                                }
                            }
                        });
                        scope.assert.equal(result.runnerErrors.length, leaked ? 1 : 0);
                        scope.assert.equal(
                            result.executedCase.result.verdict,
                            caseOwned ? 'runtime-policy' : original.verdict
                        );
                        scope.assert.deepEqual({ owner: result.runnerErrors[0]?.attributedTo ?? null }, {
                            owner: caseOwned ? testCase.id : null
                        });
                        return scope.assert.collect();
                    }
                );
            });
        });
    }),
    ...[ false, true ].flatMap(function (includeActiveResourceLeaks) {
        return [ false, true ].map(function (leak) {
            return test(
                `completes resource checks enabled ${includeActiveResourceLeaks} with leak ${leak}`,
                async function (scope: TestScope) {
                    let allocated = false;
                    const result = await completeCaseWithAsyncLeakPolicy({
                        testCase: observationCase(),
                        includeActiveResourceLeaks,
                        dependencies: {
                            asyncLeakMonitor: createDisabledAsyncLeakMonitor(),
                            readActiveResourceTypes() {
                                return allocated ? [ 'UnitResource' ] : [];
                            }
                        },
                        async complete() {
                            allocated = leak;
                            return [];
                        }
                    });
                    scope.assert.equal(result.length, includeActiveResourceLeaks && leak ? 1 : 0);
                    return scope.assert.collect();
                }
            );
        });
    })
]);
