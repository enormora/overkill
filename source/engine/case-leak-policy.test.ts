import { table, type TestNode, suite } from '@overkill-dev/test';

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
export const testNode: TestNode = suite('case leak attribution policy', [
    table({
        title: 'handles with resource checks and ambiguous ownership',
        cases: outcomes.flatMap(function (outcome) {
            return [ false, true ].flatMap(function (includeActiveResourceLeaks) {
                return [ false, true ].map(function (ambiguous) {
                    const leaked = outcome !== null && includeActiveResourceLeaks;
                    const caseOwned = leaked && !ambiguous;
                    return { outcome, includeActiveResourceLeaks, ambiguous, leaked, caseOwned };
                });
            });
        }),
        caseTitle({ outcome, includeActiveResourceLeaks, ambiguous }) {
            return [ outcome?.kind ?? 'terminal', includeActiveResourceLeaks, ambiguous ]
                .map(String)
                .join(', ');
        },
        async test(scope) {
            const require: typeof scope.require = scope.require;

            const testCase = observationCase();
            const original = runResultFactory.build({ perTest: [ {} ] }).perTest[0];
            require.defined(original);
            const executedCase = {
                result: { ...original, outcome: scope.parameters.outcome },
                runnerErrors: [],
                durationMicroseconds: 1
            };
            const result = await caseWithAsyncLeakPolicy({
                testCase,
                executedCase,
                includeActiveResourceLeaks: scope.parameters.includeActiveResourceLeaks,
                readResourceBaseline() {
                    return [];
                },
                ambiguousResources() {
                    return scope.parameters.ambiguous ? [ 'UnitResource' ] : [];
                },
                dependencies: {
                    asyncLeakMonitor: createDisabledAsyncLeakMonitor(),
                    readActiveResourceTypes() {
                        return [ 'UnitResource' ];
                    }
                }
            });
            scope.assert.equal(result.runnerErrors.length, scope.parameters.leaked ? 1 : 0);
            scope.assert.equal(
                result.executedCase.result.verdict,
                scope.parameters.caseOwned ? 'runtime-policy' : original.verdict
            );
            scope.assert.deepEqual({ owner: result.runnerErrors[0]?.attributedTo ?? null }, {
                owner: scope.parameters.caseOwned ? testCase.id : null
            });
            return scope.assert.collect();
        }
    }),
    table({
        title: 'runs resource checks according to policy',
        cases: [ false, true ].flatMap(function (includeActiveResourceLeaks) {
            return [ false, true ].map(function (leak) {
                return { includeActiveResourceLeaks, leak };
            });
        }),
        caseTitle({ includeActiveResourceLeaks, leak }) {
            return [ includeActiveResourceLeaks, leak ].map(String).join(', ');
        },
        async test(scope) {
            const { includeActiveResourceLeaks, leak } = scope.parameters;

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
    })
]);
