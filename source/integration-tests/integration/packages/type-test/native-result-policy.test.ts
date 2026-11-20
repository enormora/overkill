import { type TestNode, table, suite, test } from '@overkill-dev/test';

import * as ast from 'typescript-beta/ast';

import { sourceCall } from '../../../../test-support/native-source-fixture.ts';
import { observationPlan } from '../../../../test-support/observation-lifetime.ts';
import {
    nativeCheckResult,
    type SiteEvidence,
    type NativeCheckEvidence
} from '../../../../packages/type-test/native-results.ts';
import { caseKey, type NativeSite } from '../../../../packages/type-test/original-assertions.ts';

function evidence(): NativeCheckEvidence {
    return {
        plan: observationPlan(),
        assertionPlan: { modules: [], sites: [], issues: [] },
        checked: null,
        error: null,
        started: performance.now()
    };
}
function ownedSite(input: NativeCheckEvidence, message: string | null): NativeSite {
    return {
        path: '/project/case.ts',
        range: { start: 0, end: 3 },
        owners: [ caseKey(input.plan.cases[0]) ],
        line: 1,
        column: 2,
        message,
        call: sourceCall(ast.factory.createIdentifier('assert'), []),
        reference: { kind: 'relation', relation: 'sameType', form: 'typed', negated: false, types: [] }
    };
}
function checkedSite(site: NativeSite, result: SiteEvidence['result']): SiteEvidence {
    return { site, compilerVersion: '7.1.0-beta', actual: 'string', expected: 'number', result };
}
function selectedEvidence(message: string | null): NativeCheckEvidence & { readonly site: NativeSite; } {
    const input = evidence();
    const site = ownedSite(input, message);
    return { ...input, site, assertionPlan: { ...input.assertionPlan, sites: [ site ] } };
}
export const testNode: TestNode = suite('native checker completion policy', [
    test('rejects executable cases without native assertions', function (scope) {
        const result = nativeCheckResult(evidence());
        scope.assert.equal(result.status, 'failed');
        scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'fail',
            failures: [ { kind: 'test-contract', code: 'no-assertions', actual: 0 } ]
        });
        return scope.assert.collect();
    }),
    test('retains skipped case reasons without requiring compiler evidence', function (scope) {
        const input = evidence();
        const selected = { ...input.plan.cases[0], execution: { kind: 'skip' as const, reason: 'deliberate' } };
        const result = nativeCheckResult({ ...input, plan: { ...input.plan, cases: [ selected ] } });
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, { kind: 'skip', reason: 'deliberate' });
        return scope.assert.collect();
    }),
    test('passes established compiler evidence owned by the selected case', function (scope) {
        const input = selectedEvidence(null);
        const result = nativeCheckResult({
            ...input,
            checked: [ checkedSite(input.site, { kind: 'established', holds: true }) ]
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, { kind: 'pass' });
        return scope.assert.collect();
    }),
    table({
        title: 'retains failed type evidence with annotations',
        cases: [ null, 'Expected matching types' ],
        caseTitle(message) {
            return `${String(message)}`;
        },
        test(scope) {
            const message = scope.parameters;

            const input = selectedEvidence(message);
            const result = nativeCheckResult({
                ...input,
                checked: [ checkedSite(input.site, { kind: 'established', holds: false }) ]
            });
            scope.assert.equal(result.status, 'failed');
            scope.assert.partialDeepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
                kind: 'fail',
                failures: [ {
                    kind: 'assertion',
                    checks: [ {
                        kind: 'foreign',
                        source: 'assert',
                        summary: message ?? 'Type relation sameType does not hold (TypeScript 7.1.0-beta).',
                        sourceLocations: [ { kind: 'known', file: '/project/case.ts', line: 1, column: 2 } ],
                        error: { name: 'TypeAssertionError', thrown: 'sameType' }
                    } ]
                } ]
            });
            return scope.assert.collect();
        }
    }),
    test('requires matching site identity in compiler evidence', function (scope) {
        const input = selectedEvidence(null);
        const result = nativeCheckResult({
            ...input,
            checked: [ checkedSite({ ...input.site }, { kind: 'established', holds: true }) ]
        });
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'inconclusive',
            reason: 'Missing compiler assertion evidence.'
        });
        scope.assert.includes(result.runnerErrors[0]?.message ?? '', 'Missing compiler assertion evidence.');
        return scope.assert.collect();
    }),
    test('retains unsupported source evidence without inventing assertions', function (scope) {
        const input = evidence();
        const result = nativeCheckResult({
            ...input,
            assertionPlan: {
                ...input.assertionPlan,
                issues: [ {
                    owner: caseKey(
                        input
                            .plan
                            .cases[0]
                    ),
                    reason: 'Unsupported callback'
                } ]
            }
        });
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'inconclusive',
            reason: 'Unsupported callback'
        });
        return scope.assert.collect();
    }),
    test('retains source issues even when all known assertions pass', function (scope) {
        const input = selectedEvidence(null);
        const result = nativeCheckResult({
            ...input,
            assertionPlan: {
                ...input.assertionPlan,
                issues: [ {
                    owner: caseKey(
                        input
                            .plan
                            .cases[0]
                    ),
                    reason: 'Unsupported expression'
                } ]
            },
            checked: [ checkedSite(input.site, { kind: 'established', holds: true }) ]
        });
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'inconclusive',
            reason: 'Unsupported expression'
        });
        return scope.assert.collect();
    }),
    test('retains inconclusive type relations after complete source ownership', function (scope) {
        const input = selectedEvidence(null);
        const result = nativeCheckResult({
            ...input,
            checked: [ checkedSite(input.site, { kind: 'inconclusive', reason: 'Unknown relation' }) ]
        });
        scope.assert.deepEqual<unknown, unknown>(result.perTest[0]?.outcome, {
            kind: 'inconclusive',
            reason: 'Unknown relation'
        });
        return scope.assert.collect();
    }),
    test('retains assertion failures ahead of missing or unsupported evidence', function (scope) {
        const input = selectedEvidence(null);
        const result = nativeCheckResult({
            ...input,
            assertionPlan: {
                ...input.assertionPlan,
                sites: [ input.site, { ...input.site } ],
                issues: [ { owner: caseKey(input.plan.cases[0]), reason: 'Unsupported expression' } ]
            },
            checked: [ checkedSite(input.site, { kind: 'established', holds: false }) ]
        });
        scope.assert.equal(result.perTest[0]?.verdict, 'fail');
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    table({
        title: 'retains compiler failures',
        cases: [ new Error('Compiler unavailable'), 'unknown failure' ],
        caseTitle(error) {
            return `${String(error)}`;
        },
        test(scope) {
            const error = scope.parameters;

            const result = nativeCheckResult({ ...evidence(), error });
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(
                result.runnerErrors[0]?.message,
                error instanceof Error ? error.message : 'Checker setup failed.'
            );
            scope.assert.equal(result.runnerErrors[0]?.cause, error);
            return scope.assert.collect();
        }
    })
]);
