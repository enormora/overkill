import assert from 'node:assert/strict';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { ExecuteOptions } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';

const options: ExecuteOptions = {
    execution: { mode: 'serial-in-process' },
    retryPolicy: null,
    reporters: [],
    runFacts: {},
    startedAt: '1970-01-01T00:00:00.000Z'
};

type ScopeSample = { readonly seed: string; readonly bytes: Uint8Array; };

async function sampleScope(input: ExecuteOptions | undefined): Promise<ScopeSample> {
    const engine = createTestEngine();
    const observations: ScopeSample[] = [];
    const result = await engine.execute(
        engine.createTestPlan(engine.createRoot({
            title: 'scope defaults',
            annotations: {},
            controls: {},
            children: [ engine.createTestCase({
                title: 'case',
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                body(scope) {
                    observations.push({ seed: scope.seed.toString(), bytes: scope.random.bytes(16) });
                    scope.assert.true(true);
                    return scope.assert.collect();
                }
            }) ]
        })),
        input
    );
    assert.equal(result.status, 'passed');
    const observation = observations[0];
    assert.ok(observation !== undefined);
    return observation;
}

export const testNode = suite('case scope compatibility', [
    test('defaults omitted execution seeds to zero', async function (scope) {
        const explicit = await sampleScope({ ...options, seed: 0n });
        scope.assert.deepEqual(await sampleScope(undefined), explicit);
        scope.assert.deepEqual(await sampleScope(options), explicit);
        return scope.assert.collect();
    }),
    test('inherits legacy property seeds and honors explicit seed precedence', async function (scope) {
        const explicit = await sampleScope({ ...options, seed: 42n });
        scope.assert.deepEqual(
            await sampleScope({
                ...options,
                propertyRun: { seed: 42n, projectRoot: null }
            }),
            explicit
        );
        scope.assert.deepEqual(
            await sampleScope({
                ...options,
                seed: 42n,
                propertyRun: { seed: 99n, projectRoot: null }
            }),
            explicit
        );
        return scope.assert.collect();
    }),
    test('rejects non-bigint execution seeds', async function (scope) {
        for (const seed of [ undefined, null, 42, '42' ]) {
            const input = { ...options, seed: 42n };
            Reflect.set(input, 'seed', seed);
            await scope.assert.rejects(async function invalidSeed() {
                await sampleScope(input);
            }, { type: TypeError, message: 'Execution seed must be a bigint.' });
        }
        return scope.assert.collect();
    }),
    ...([ 'assert', 'require' ] as const).map(function assertionContracts(method) {
        return test(`throwing scopes retain ${method} reference validation`, async function (scope) {
            const engine = createTestEngine();
            const result = await engine.execute(
                engine.createTestPlan(engine.createRoot({
                    title: 'throwing contract',
                    annotations: {},
                    controls: {},
                    children: [ engine.createThrowingTestCase({
                        title: 'case',
                        annotations: {},
                        controls: {},
                        definitionLocations: [ { kind: 'unknown' } ],
                        body(testScope) {
                            const facade: unknown = testScope[method];
                            assert.ok(typeof facade === 'function');
                            Reflect.apply(facade, undefined, [ null ]);
                        }
                    }) ]
                })),
                options
            );
            scope.assert.equal(result.summary.failed, 1);
            const outcome = result.perTest[0]?.outcome;
            assert.ok(outcome?.kind === 'fail');
            scope.assert.deepEqual(outcome.failures, [ {
                actual: null,
                code: 'invalid-assertion-reference',
                expected: 'engine-created assertion reference',
                kind: 'test-contract',
                summary: 'Expected an engine-created assertion reference.'
            } ]);
            return scope.assert.collect();
        });
    })
]);

await runIfMain(import.meta, testNode);
