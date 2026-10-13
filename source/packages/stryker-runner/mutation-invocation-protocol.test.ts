import { deserialize, serialize } from 'node:v8';
import { suite, test } from '../test/test.entry-point.ts';
import { ConfigError, RunCollectionError, RunResolutionError, parseRunSelection } from '../run/run.entry-point.ts';
import { mutationInvocationFailure, restoreMutationInvocationFailure } from './mutation-invocation-failure.ts';
import { mutationInvocationRequestSchema, mutationInvocationResponseSchema } from './mutation-invocation-protocol.ts';

function transportedFailure(error: Error): Error {
    const response = mutationInvocationResponseSchema.parse(deserialize(serialize({
        kind: 'failure',
        failure: mutationInvocationFailure(error)
    })));
    if (response.kind !== 'failure') {
        throw new Error('Failure transport returned a result.');
    }
    return restoreMutationInvocationFailure(response.failure);
}

export const testNode = suite('mutation invocation transport', [
    test('preserves configuration causes and stacks through native serialization', function (scope) {
        const original = new ConfigError('invalid policy', { cause: new Error('config sentinel') });
        const restored = transportedFailure(original);
        scope.assert.equal(restored instanceof ConfigError, true);
        scope.assert.equal(restored.message, original.message);
        scope.assert.equal(restored.stack, original.stack);
        scope.assert.equal(restored.cause instanceof Error ? restored.cause.message : null, 'config sentinel');
        return scope.assert.collect();
    }),
    test('preserves resolution codes through native serialization', function (scope) {
        const restored = transportedFailure(
            new RunResolutionError('unsupported', { cause: null }, 'unsupported-request')
        );
        if (!(restored instanceof RunResolutionError)) {
            throw new Error('Resolution failure lost its type.');
        }
        scope.assert.equal(restored.code(), 'unsupported-request');
        scope.assert.equal(restored.message, 'unsupported');
        return scope.assert.collect();
    }),
    test('preserves collection diagnostics through native serialization', function (scope) {
        const restored = transportedFailure(
            new RunCollectionError('collection failed', { cause: new Error('collection sentinel') }, 'loader')
        );
        if (!(restored instanceof RunCollectionError)) {
            throw new Error('Collection failure lost its type.');
        }
        scope.assert.equal(restored.runnerErrors()[0]?.subtype, 'loader');
        scope.assert.equal(restored.runnerErrors()[0]?.message, 'collection failed');
        return scope.assert.collect();
    }),
    test('rejects malformed requests, results, and collection diagnostics', function (scope) {
        const invalid = [
            {},
            { kind: 'result', result: {} },
            { kind: 'failure', failure: {} },
            {
                kind: 'failure',
                failure: { kind: 'collection-error', message: 'invalid', cause: null, stack: null, errors: [] }
            }
        ];
        for (const message of invalid) {
            scope.assert.throws(function rejectMalformedResponse() {
                return mutationInvocationResponseSchema.parse(message);
            }, { type: Error });
        }
        scope.assert.throws(function rejectMalformedRequest() {
            return mutationInvocationRequestSchema.parse({
                kind: 'run',
                policy: {},
                seed: { value: -1n },
                selection: { kind: 'all' }
            });
        }, { type: Error });
        scope.assert.throws(function rejectMalformedSelection() {
            return parseRunSelection({ kind: 'filter', filter: { kind: 'case-id', id: {} } });
        }, { type: Error });
        return scope.assert.collect();
    })
]);
