import { runIfMain } from '#test-runner';
import { Diagnostic } from 'tstyche/api';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { observationPlan } from '../../test-support/observation-lifetime.ts';
import { nativeCheckResult } from './native-results.ts';
import { caseKey } from './native-translation.ts';
import type { CheckerRun } from './checker.entry-point.ts';

type NativeEvidence = Parameters<typeof nativeCheckResult>[0];
function evidence(): NativeEvidence {
    return {
        plan: observationPlan(),
        translation: { modules: [], sites: [] },
        checked: null,
        error: null,
        started: performance.now()
    };
}
function checked(events: CheckerRun['events']): CheckerRun {
    return {
        originalProjectPath: '/project/tsconfig.json',
        checkerConfigPath: '/project/checker.json',
        compilerVersion: '7.1.0-beta',
        events,
        inputs: {
            modules: [],
            mapRange() {
                return [];
            }
        }
    };
}
export const testNode = suite('native checker completion policy', [
    test('rejects executable cases without native assertions', function (scope: TestScope) {
        const result = nativeCheckResult(evidence());
        scope.assert.equal(result.status, 'failed');
        scope.assert.partialDeepEqual(result.perTest, [ {
            outcome: { kind: 'fail', failures: [ { kind: 'test-contract', code: 'no-assertions' } ] }
        } ]);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    test('retains missing assertion evidence as inconclusive', function (scope: TestScope) {
        const input = evidence();
        const site = {
            path: '/project/case.ts',
            range: { start: 0, end: 10 },
            owners: [ caseKey(input.plan.cases[0]) ],
            line: 1,
            column: 1,
            message: null
        };
        const result = nativeCheckResult({ ...input, translation: { modules: [], sites: [ site ] } });
        scope.assert.equal(result.perTest[0]?.verdict, 'inconclusive');
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            message: 'Type-test checks are inconclusive; assertion evidence is incomplete.'
        } ]);
        return scope.assert.collect();
    }),
    ...[ new Error('compiler unavailable'), 42 ].map(function (error, index) {
        return test(`retains setup failure ${index}`, function (scope: TestScope) {
            const result = nativeCheckResult({ ...evidence(), error });
            scope.assert.partialDeepEqual(result.runnerErrors, [ {
                message: index === 0 ? 'compiler unavailable' : 'Checker setup failed.'
            } ]);
            scope.assert.equal(result.runnerErrors[0]?.cause, error);
            return scope.assert.collect();
        });
    }),
    test('preserves skipped cases without requiring checker evidence', function (scope: TestScope) {
        const input = evidence(), original = input.plan.cases[0];
        const testCase = {
            ...original,
            skipReason: 'unsupported',
            execution: { kind: 'skip' as const, reason: 'unsupported' }
        };
        const result = nativeCheckResult({
            ...input,
            plan: { ...input.plan, cases: [ testCase ], discoveredCases: [ testCase ] }
        });
        scope.assert.partialDeepEqual(result.perTest, [ {
            verdict: 'skip',
            outcome: { kind: 'skip', reason: 'unsupported' }
        } ]);
        return scope.assert.collect();
    }),
    test('retains compiler collection diagnostics and nested detail', function (scope: TestScope) {
        const diagnostic = Diagnostic.error([ 'invalid', 'configuration' ]);
        diagnostic.related = [ Diagnostic.error('detail') ];
        const result = nativeCheckResult({
            ...evidence(),
            checked: checked([ [ 'collect:error', { diagnostics: [ diagnostic ] } ] ])
        });
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            subtype: 'loader',
            message: 'invalid\nconfiguration\ndetail'
        } ]);
        return scope.assert.collect();
    }),
    test('does not invent compiler errors for an empty successful event stream', function (scope: TestScope) {
        const result = nativeCheckResult({ ...evidence(), checked: checked([]) });
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
