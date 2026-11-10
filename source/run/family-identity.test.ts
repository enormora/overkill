import { runIfMain } from '#test-runner';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import {
    artifactIdentityProjection,
    artifactsForAttempt,
    createBoundaryFailureArtifact
} from '../engine/run-artifact.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { replayWorkUnitIdSchema } from './replay-placement-schema.ts';
import { attachmentMatchesAttempt } from './attachment-results.ts';
import { caseWorkUnitId, groupedExecutionBuckets, workUnitIdentityProjection } from './work-unit-identity.ts';
import { workUnitBelongsToShard } from './run-sharding.ts';

const logical = { file: 'case.ts', suite: [], title: 'example', params: null };
const neutral = createDefaultWorkId(logical);
const first = { ...neutral, familyVariant: { family: '@example/checks', key: 'one' } };
const second = { ...neutral, familyVariant: { family: '@example/checks', key: 'two' } };

export const testNode = suite('family identity', [
    test('retains the exact neutral shard input', function (scope: TestScope) {
        const unit = caseWorkUnitId(neutral);
        const inputs: string[] = [];
        workUnitBelongsToShard(unit, { index: 1, total: 2 }, {
            hash(input) {
                inputs.push(input);
                return 0n;
            }
        });
        scope.assert.deepEqual(inputs, [
            '{"key":"[\\"case.ts\\",[],\\"example\\",null]","mode":"case","runtimes":[],"workload":null}'
        ]);
        return scope.assert.collect();
    }),
    test('separates family execution buckets and retains their unit identity', function (scope: TestScope) {
        const reordered = { ...first, familyVariant: { key: 'one', family: '@example/checks' } };
        scope.assert.deepEqual(groupedExecutionBuckets([ first, second, reordered ]), [ [ first, reordered ], [
            second
        ] ]);
        const variant = caseWorkUnitId(first).familyVariant;
        scope.require.notNull(variant);
        scope.assert.deepEqual(variant, first.familyVariant);
        scope.assert.equal(Object.hasOwn(workUnitIdentityProjection(caseWorkUnitId(neutral)), 'familyVariant'), false);
        return scope.assert.collect();
    }),
    test('decodes legacy compiler work without executable family code', function (scope: TestScope) {
        const { familyVariant, ...legacy } = neutral;
        scope.assert.equal(familyVariant, null);
        scope.assert.deepEqual(workIdSchema.parse(legacy), neutral);
        scope.assert.equal(Reflect.apply(workIdentityKey, null, [ legacy ]), workIdentityKey(neutral));
        scope.assert.deepEqual(workIdSchema.parse({ ...legacy, compiler: { name: 'typescript', version: '6.0.3' } }), {
            ...neutral,
            familyVariant: { family: '@overkill-dev/type-test', key: 'typescript@6.0.3' }
        });
        return scope.assert.collect();
    }),
    test('keeps case artifacts within their family variant', function (scope: TestScope) {
        const artifact: RuntimeAttachmentArtifact = {
            id: {
                familyVariant: first.familyVariant,
                runtimes: first.runtimes,
                workload: first.workload,
                scope: { kind: 'case', case: logical, activeCases: [ logical ], confidence: 'active-case' },
                attempt: { index: 0 },
                sequence: 0,
                subtype: 'attachment'
            },
            source: 'native',
            payload: {
                kind: 'runtime-attachment',
                name: 'evidence',
                mediaType: 'application/json',
                capturedAtMicroseconds: 0,
                producer: { kind: 'case' },
                capture: 'opt-in',
                content: { kind: 'json', value: null, byteLength: 4 }
            }
        };
        scope.assert.equal(attachmentMatchesAttempt(artifact, first, { index: 0 }), true);
        scope.assert.equal(attachmentMatchesAttempt(artifact, second, { index: 0 }), false);
        scope.assert.deepEqual(artifactsForAttempt([ artifact ], first, { index: 0 }), [ artifact ]);
        scope.assert.deepEqual(artifactsForAttempt([ artifact ], second, { index: 0 }), []);
        return scope.assert.collect();
    }),
    test('retains family variants in boundary failure evidence', function (scope: TestScope) {
        const artifact = createBoundaryFailureArtifact(
            {
                kind: 'worker-crash',
                reason: 'worker closed',
                exitCode: 1,
                signal: null,
                coreDumpPath: null,
                nativeAddons: null
            },
            { timestamp: '2026-11-10T00:00:00Z', workerId: null, nodeVersion: null, source: 'native' },
            [ { work: first, attempt: { index: 0 } } ],
            0
        );
        scope.assert.deepEqual(artifact.id, {
            attempt: { index: 0 },
            familyVariant: first.familyVariant,
            runtimes: [],
            workload: null,
            sequence: 0,
            subtype: 'worker-crash',
            scope: { kind: 'case', case: logical, activeCases: [ logical ], confidence: 'active-case' }
        });
        return scope.assert.collect();
    }),
    test('normalizes recorded compiler units consistently with work identity', function (scope: TestScope) {
        const key = JSON.stringify([
            'compiler',
            'typescript',
            '6.0.3',
            JSON.stringify([ 'case.ts', [], 'example', null ]),
            [],
            null
        ]);
        const recorded = replayWorkUnitIdSchema.parse({ key, mode: 'case', runtimes: [], workload: null });
        scope.assert.deepEqual(
            recorded,
            caseWorkUnitId({
                ...neutral,
                familyVariant: { family: '@overkill-dev/type-test', key: 'typescript@6.0.3' }
            })
        );
        return scope.assert.collect();
    }),
    test('omits neutral artifact dimensions and retains scoped variants', function (scope: TestScope) {
        const id = {
            attempt: null,
            scope: { kind: 'run' as const },
            runtimes: [],
            workload: null,
            sequence: 0,
            subtype: 'attachment' as const,
            familyVariant: null
        };
        scope.assert.equal(Object.hasOwn(artifactIdentityProjection(id), 'familyVariant'), false);
        scope.assert.deepEqual(artifactIdentityProjection({ ...id, familyVariant: first.familyVariant }), {
            ...id,
            familyVariant: first.familyVariant
        });
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
