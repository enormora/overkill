import { runIfMain } from '#test-runner';
import { Diagnostic } from 'tstyche/api';
import { suite, test, type TestScope } from '../test/test.entry-point.ts';
import { observationPlan } from '../../test-support/observation-lifetime.ts';
import { nativeCheckResult, type NativeCheckEvidence } from './native-results.ts';
import type { AssertionEvent } from './native-check-evidence.ts';
import { caseKey } from './native-translation.ts';

const generatedPath = '/project/generated.ts';
const originalPath = '/project/case.ts';
function assertionEvent(name: AssertionEvent[0], diagnostics: readonly Diagnostic[]): AssertionEvent {
    const result = {
        expect: {
            node: {
                end: 3,
                getStart() {
                    return 0;
                },
                getSourceFile() {
                    return { fileName: generatedPath };
                }
            }
        }
    };
    return name === 'expect:pass' ? [ name, { result } ] : [ name, { result, diagnostics } ];
}
function evidence(events: readonly AssertionEvent[], message: string | null): NativeCheckEvidence {
    const plan = observationPlan();
    const range = { start: 0, end: 3 };
    const mappings = [ { kind: 'copied' as const, original: range, generated: range } ];
    return {
        plan,
        error: null,
        started: performance.now(),
        translation: {
            modules: [ { path: originalPath, text: 'abc', originalText: 'abc', mappings } ],
            sites: [ { path: originalPath, range, owners: [ caseKey(plan.cases[0]) ], line: 1, column: 1, message } ]
        },
        checked: {
            events,
            inputs: {
                modules: [ {
                    kind: 'ready',
                    path: generatedPath,
                    provenance: {
                        originalPath,
                        generatedPath,
                        originalFingerprint: 'original',
                        generatedFingerprint: 'generated',
                        mappings,
                        repairs: [],
                        limitations: []
                    }
                } ],
                mapRange(_path, sourceRange) {
                    return [ sourceRange ];
                }
            }
        }
    };
}
export const testNode = suite('native checker assertion outcomes', [
    test('maps passing checker events back to their original case', function (scope: TestScope) {
        const result = nativeCheckResult(evidence([ assertionEvent('expect:pass', []) ], null));
        scope.assert.equal(result.status, 'passed');
        scope.assert.partialDeepEqual(result.perTest, [ { verdict: 'pass', outcome: { kind: 'pass' } } ]);
        scope.assert.deepEqual(result.runnerErrors, []);
        return scope.assert.collect();
    }),
    ...([ 'expect:error', 'expect:fail' ] as const).flatMap(function failedEvent(name) {
        return [ null, 'Expected assignable value' ].map(function annotation(message) {
            return test(`preserves ${name} with annotation ${String(message)}`, function (scope: TestScope) {
                const result = nativeCheckResult(evidence([ assertionEvent(name, []) ], message));
                scope.assert.partialDeepEqual(result.perTest, [ {
                    verdict: 'fail',
                    outcome: {
                        kind: 'fail',
                        failures: [ {
                            kind: 'assertion',
                            checks: [ {
                                summary: message ?? 'TSTyche assertion failed.',
                                error: { message: 'TSTyche assertion failed.' },
                                sourceLocations: [ {
                                    kind: 'known',
                                    file: originalPath,
                                    line: 1,
                                    column: 1
                                } ]
                            } ]
                        } ]
                    }
                } ]);
                scope.assert.deepEqual(result.runnerErrors, []);
                return scope.assert.collect();
            });
        });
    }),
    test('retains failed evidence and diagnostics when a later event passes', function (scope: TestScope) {
        const events = [
            assertionEvent('expect:pass', []),
            assertionEvent('expect:fail', [ Diagnostic.error('Type mismatch') ]),
            assertionEvent('expect:pass', [])
        ];
        const result = nativeCheckResult(evidence(events, null));
        scope.assert.partialDeepEqual(result.perTest, [ {
            verdict: 'fail',
            outcome: {
                failures: [ {
                    checks: [ { summary: 'Type mismatch', error: { message: 'Type mismatch' } } ]
                } ]
            }
        } ]);
        scope.assert.equal(result.perTest.length, 1);
        return scope.assert.collect();
    }),
    ...([ 'missing-module', 'unmapped-range', 'unowned-site' ] as const).map(function missingOwnership(mode) {
        return test(`rejects assertion evidence with ${mode}`, function (scope: TestScope) {
            const input = evidence([ assertionEvent('expect:pass', []) ], null);
            const { checked } = input;
            scope.require.defined(checked);
            const inputs = {
                ...checked.inputs,
                modules: mode === 'missing-module' ? [] : checked.inputs.modules,
                mapRange() {
                    return mode === 'unmapped-range' ? [] : [ { start: 0, end: 3 } ];
                }
            };
            const result = nativeCheckResult({
                ...input,
                checked: { ...checked, inputs },
                translation: mode === 'unowned-site' ? { ...input.translation, sites: [] } : input.translation
            });
            scope.assert.equal(result.status, 'failed');
            scope.assert.equal(
                result.runnerErrors[0]?.message,
                'Checker reported an assertion without native source ownership.'
            );
            scope.assert.equal(result.perTest[0]?.verdict, mode === 'unowned-site' ? 'fail' : 'inconclusive');
            return scope.assert.collect();
        });
    })
]);
await runIfMain(import.meta, testNode);
