import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createCaseId, createDefaultWorkId } from '../engine/identity.ts';
import {
    defineBaselineAdapter,
    type BaselineAdapterDefinition,
    type BaselinePayload
} from '../packages/run/run.entry-point.ts';
import type { BaselineUpdateMode } from '../baselines/baseline-model.ts';

type CountObservation = { readonly count: number; };
type CountComparison = { readonly actual: number; readonly expected: number; };
type CountProposal = { readonly actual: number; };
type NullComparison = { readonly expected: null; };

const work = createDefaultWorkId(createCaseId('output.test.ts', [], 'output', null));
const existing: BaselinePayload = { kind: 'text', text: '42' };

export const testNode = suite('ordinary baseline adapters', [
    test('keeps observation, comparison, and proposal values distinct', async function (scope: TestScope) {
        const adapter = defineBaselineAdapter({
            subtype: 'content-snapshot',
            comparisonContext: {},
            adapter: {
                id: 'output',
                async observe() {
                    return { kind: 'observed', value: { count: 42 } };
                },
                async compare(input: CountComparison) {
                    return input.actual === input.expected ? { kind: 'match' } : {
                        kind: 'mismatch',
                        diagnostics: [ { actual: input.actual, expected: input.expected, summary: 'Changed count' } ]
                    };
                },
                async propose(input: CountProposal) {
                    return [ input.actual ];
                }
            },
            async toComparisonValue(observed: CountObservation) {
                return observed.count;
            },
            async encode(proposal: readonly number[]) {
                return { kind: 'text', text: JSON.stringify(proposal) };
            },
            async decode(payload) {
                if (payload.kind !== 'text') {
                    throw new Error('Expected text');
                }
                return Number(payload.text);
            }
        });
        scope.assert.deepEqual(await adapter.evaluate({ artifacts: [], work, existing, mode: 'none' }), {
            kind: 'observed',
            comparison: { kind: 'match' },
            proposal: null
        });
        scope.assert.deepEqual(await adapter.evaluate({ artifacts: [], work, existing, mode: 'update' }), {
            kind: 'observed',
            comparison: null,
            proposal: { kind: 'text', text: '[42]' }
        });
        return scope.assert.collect();
    }),
    test('does not propose during comparison or existing bootstrap', async function (scope: TestScope) {
        const adapter = defineBaselineAdapter({
            subtype: 'terminal-snapshot',
            comparisonContext: {},
            adapter: {
                id: 'terminal',
                observe() {
                    return { kind: 'observed', value: null };
                },
                compare(input: NullComparison) {
                    scope.assert.equal(input.expected, null);
                    return { kind: 'match' };
                },
                propose() {
                    throw new Error('Unexpected proposal');
                }
            },
            toComparisonValue(value: null) {
                return value;
            },
            encode() {
                throw new Error('Unexpected encoding');
            },
            decode() {
                return null;
            }
        });
        const modes: readonly BaselineUpdateMode[] = [ 'none', 'bootstrap' ];
        for (const mode of modes) {
            scope.assert.deepEqual(await adapter.evaluate({ artifacts: [], work, existing, mode }), {
                kind: 'observed',
                comparison: { kind: 'match' },
                proposal: null
            });
        }
        return scope.assert.collect();
    }),
    test('passes unavailable observations through without invoking codecs', async function (scope: TestScope) {
        for (const observation of [ { kind: 'not-applicable' }, { kind: 'missing', reason: 'No output' } ] as const) {
            const adapter = defineBaselineAdapter({
                subtype: 'visual-snapshot',
                comparisonContext: {},
                adapter: {
                    id: 'visual',
                    observe() {
                        return observation;
                    },
                    compare() {
                        throw new Error('Unexpected comparison');
                    },
                    propose() {
                        throw new Error('Unexpected proposal');
                    }
                },
                toComparisonValue() {
                    throw new Error('Unexpected conversion');
                },
                encode() {
                    throw new Error('Unexpected encoding');
                },
                decode() {
                    throw new Error('Unexpected decoding');
                }
            });
            scope.assert.deepEqual(
                await adapter.evaluate({ artifacts: [], work, existing, mode: 'apply' }),
                observation
            );
        }
        return scope.assert.collect();
    }),
    test('creates binary proposals for every write and preview mode', async function (scope: TestScope) {
        const definition: BaselineAdapterDefinition<Uint8Array, Uint8Array, Uint8Array> = {
            subtype: 'visual-snapshot',
            comparisonContext: { browser: 'test-browser' },
            adapter: {
                id: 'binary',
                observe() {
                    return { kind: 'observed', value: new Uint8Array([ 0, 255 ]) };
                },
                compare() {
                    throw new Error('Unexpected comparison');
                },
                propose({ actual }) {
                    return actual;
                }
            },
            toComparisonValue(value) {
                return value;
            },
            encode(bytes) {
                return { kind: 'binary', bytes };
            },
            decode() {
                throw new Error('Unexpected decoding');
            }
        };
        const adapter = defineBaselineAdapter(definition);
        const modes: readonly BaselineUpdateMode[] = [ 'apply', 'bootstrap', 'diff', 'update' ];
        for (const mode of modes) {
            scope.assert.deepEqual(await adapter.evaluate({ artifacts: [], work, existing: null, mode }), {
                kind: 'observed',
                comparison: null,
                proposal: { kind: 'binary', bytes: new Uint8Array([ 0, 255 ]) }
            });
        }
        return scope.assert.collect();
    })
]);
