import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import type { PropertyWitnessFile } from '../engine/witness-file.ts';
import { emptyPropertyCorpus } from '../engine/property-corpus.ts';
import { testNode as invocationTargets } from './property-corpus-targets.test.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

async function witness(): Promise<PropertyWitnessFile> {
    const result = await executePropertyNode(
        property({
            title: 'stored regression',
            generator: gen.constant(42),
            test(value, sample) {
                sample.failureKey('stored');
                sample
                    .assert
                    .equal(value, 0);
                return sample.assert.collect();
            }
        }),
        propertyExecutionDefaults
    );
    const saved = result.perTest[0]?.property?.invocations[0]?.confirmedWitness;
    if (saved === null || saved === undefined) {
        throw new Error('Expected a confirmed witness.');
    }
    return saved;
}

export const testNode = suite('stored property regressions', [
    invocationTargets,
    test('replays a witness once without exploring or confirming it', async function (scope) {
        const saved = await witness();
        const inputs: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'stored regression',
                generator: gen.constant(0).map(function forbidGeneration() {
                    throw new Error('Replay must not generate inputs.');
                }),
                test(value, sample) {
                    inputs.push(value);
                    sample.assert.equal(value, 42);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, replay: saved }
        );
        scope.assert.deepEqual(inputs, [ 42 ]);
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('rejects an incompatible direct replay without executing the body', async function (scope) {
        const saved = await witness();
        const inputs: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'stored regression',
                generator: gen.constant(0),
                test(value, sample) {
                    inputs.push(value);
                    sample.assert.true(true);
                    return sample.assert.collect();
                }
            }),
            {
                ...propertyExecutionDefaults,
                replay: {
                    ...saved,
                    counterexample: { ...saved.counterexample, format: { name: 'future', version: 99 } }
                }
            }
        );
        scope.assert.deepEqual(inputs, []);
        scope.assert.true(result.runnerErrors.some(function replayError(error) {
            return error.subtype === 'witness-replay';
        }));
        scope.assert.equal(result.summary.passed, 0);
        return scope.assert.collect();
    }),
    test('rejects replay when the selected declaration is no longer a property', async function (scope) {
        const saved = await witness();
        const inputs: string[] = [];
        const result = await executePropertyNode(
            test('stored regression', function (parent) {
                inputs.push('executed');
                parent.assert.true(true);
                return parent.assert.collect();
            }),
            { ...propertyExecutionDefaults, replay: saved }
        );
        scope.assert.deepEqual(inputs, []);
        scope.assert.true(result.runnerErrors.some(function replayError(error) {
            return error.subtype === 'witness-replay';
        }));
        return scope.assert.collect();
    }),
    test('replays confirmed inputs outside the current generation domain', async function (scope) {
        const saved = await witness();
        const inputs: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'stored regression',
                generator: gen.constant(0),
                test(value, sample) {
                    inputs.push(value);
                    sample.failureKey('stored');
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                }
            }),
            { ...propertyExecutionDefaults, corpus: { ...emptyPropertyCorpus, checkedIn: [ saved ] } }
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(inputs, [ 42, 42 ]);
        return scope.assert.collect();
    }),
    test('skips incompatible local entries but fails incompatible checked-in entries', async function (scope) {
        const saved = await witness();
        const incompatible = {
            ...saved,
            counterexample: { ...saved.counterexample, format: { name: 'future', version: 99 } }
        };
        const node = property({
            title: 'stored regression',
            generator: gen.constant(0),
            test(value, sample) {
                sample.assert.equal(value, 0);
                return sample.assert.collect();
            }
        });
        const local = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            corpus: { ...emptyPropertyCorpus, localCache: [ incompatible ] }
        });
        const checkedIn = await executePropertyNode(node, {
            ...propertyExecutionDefaults,
            corpus: { ...emptyPropertyCorpus, checkedIn: [ incompatible ] }
        });
        scope.assert.equal(local.summary.passed, 1);
        scope.assert.includes(JSON.stringify(local), 'Skipped incompatible local');
        scope.assert.equal(checkedIn.summary.passed, 0);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
