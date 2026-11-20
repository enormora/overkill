import { type TestNode, suite, test } from '@overkill-dev/test';

import { frozenMicrotestPolicy } from '../../test-support/frozen-microtest-policy.ts';
import { mutationPolicyRequestSchema, mutationPolicyResponseSchema } from './mutation-policy-protocol.ts';

export const testNode: TestNode = suite('mutation policy protocol validation', [
    test('restores a serialized frozen microtest policy', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        const encoded = JSON.stringify({ kind: 'policy', policy });
        const response = mutationPolicyResponseSchema.parse(JSON.parse(encoded));
        scope.assert.deepEqual<unknown, unknown>(response, { kind: 'policy', policy });
        scope.assert.true(Object.isFrozen(response));
        return scope.assert.collect();
    }),
    test('rejects incomplete policies and policies for other test families', async function (scope) {
        const policy = await frozenMicrotestPolicy();
        scope.assert.throws(function () {
            mutationPolicyResponseSchema.parse({ kind: 'policy', policy: { ...policy, files: [] } });
        }, { type: Error });
        scope.assert.throws(function () {
            mutationPolicyResponseSchema.parse({
                kind: 'policy',
                policy: { ...policy, profile: { ...policy.profile, testFamily: 'integration' } }
            });
        }, { type: Error });
        return scope.assert.collect();
    }),
    test('preserves typed failure classifications across serialization', function (scope) {
        for (
            const response of [
                { kind: 'config-error', message: 'Invalid configuration.', cause: 'Invalid seed.' },
                { kind: 'config-error', message: 'Invalid configuration.', cause: null },
                { kind: 'resolution-error', message: 'Unsupported.', code: 'unsupported-request' },
                { kind: 'error', message: 'Backend failed.' }
            ]
        ) {
            const parsed = mutationPolicyResponseSchema.parse(response);
            scope.assert.deepEqual<unknown, unknown>(parsed, response);
            scope.assert.true(Object.isFrozen(parsed));
        }
        return scope.assert.collect();
    }),
    test('validates request structure before resolving configuration', function (scope) {
        const input = { kind: 'resolve-policy', cwd: '/project', sandbox: null, settings: { seed: '42' } };
        scope.assert.deepEqual(mutationPolicyRequestSchema.parse(input), input);
        scope.assert.throws(function () {
            mutationPolicyRequestSchema.parse({ ...input, cwd: 42 });
        }, { type: Error });
        scope.assert.throws(function () {
            mutationPolicyRequestSchema.parse({ ...input, unexpected: true });
        }, { type: Error });
        scope.assert.throws(function () {
            mutationPolicyResponseSchema.parse({ kind: 'resolution-error', message: 'Failure.', code: 'unknown' });
        }, { type: Error });
        return scope.assert.collect();
    })
]);
