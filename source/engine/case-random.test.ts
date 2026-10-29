import assert from 'node:assert/strict';
import { Hash } from 'node:crypto';
import { mock } from 'node:test';
import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import type { ExecuteExecution, TestRandom } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { createTestRandom } from './case-random.ts';
import { testNode as scopeTestNode } from './case-scope.test.ts';

type RandomEvidence = { readonly seed: string; readonly values: readonly number[]; };

function draw(random: TestRandom): readonly number[] {
    return Array.from({ length: 8 }, function integerSample() {
        return random.integer(0, 0xFF_FF_FF_FF);
    });
}

function caseEvidence(records: ReadonlyMap<string, RandomEvidence>, title: string): RandomEvidence {
    const evidence = records.get(title);
    if (evidence === undefined) {
        throw new Error(`Missing random evidence for ${title}.`);
    }
    return evidence;
}

async function executeRandomCases(
    seed: bigint,
    titles: readonly string[],
    execution: ExecuteExecution
): Promise<ReadonlyMap<string, RandomEvidence>> {
    const engine = createTestEngine();
    const evidence = new Map<string, RandomEvidence>();
    const nodes = titles.map(function randomCase(title) {
        return engine.createTestCase({
            title,
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                evidence.set(title, { seed: scope.seed.toString(), values: draw(scope.random) });
                scope.assert.true(true);
                return scope.assert.collect();
            }
        });
    });
    const result = await engine.execute(
        engine.createTestPlan(engine.createRoot({
            title: 'random cases',
            children: nodes,
            annotations: {},
            controls: {}
        })),
        {
            seed,
            execution,
            retryPolicy: null,
            reporters: [],
            runFacts: {},
            startedAt: '1970-01-01T00:00:00.000Z'
        }
    );
    assert.equal(result.status, 'passed');
    return evidence;
}

function randomFromZeroDigest(): TestRandom {
    const digest = mock.method(Hash.prototype, 'digest', function zeroDigest() {
        return Buffer.alloc(32);
    });
    try {
        return createTestRandom(0n);
    } finally {
        digest.mock.restore();
    }
}

export const testNode = suite('case random streams', [
    scopeTestNode,
    test('recovers from an all-zero hashed generator state', function (scope) {
        const random = randomFromZeroDigest();
        scope.assert.notDeepEqual(draw(random), draw(random));
        return scope.assert.collect();
    }),
    test('replays the version-one seed-zero stream', function (scope) {
        const random = createTestRandom(0n);
        scope.assert.deepEqual(draw(random).slice(0, 4), [
            0x3F_E0_8F_EC,
            0xB3_94_CD_C9,
            0x44_CD_E6_99,
            0x83_82_4E_28
        ]);
        return scope.assert.collect();
    }),
    test('splits reproducibly without sharing mutable state', function (scope) {
        const root = createTestRandom(42n);
        const replay = createTestRandom(42n);
        const [ first, second ] = root.split();
        const [ firstReplay, secondReplay ] = replay.split();
        const firstValues = draw(first);
        draw(first);
        const secondValues = draw(second);
        scope.assert.deepEqual({ first: firstValues, second: secondValues, parent: draw(root) }, {
            first: draw(firstReplay),
            second: draw(secondReplay),
            parent: draw(replay)
        });
        scope.assert.notDeepEqual(firstValues, secondValues);
        return scope.assert.collect();
    }),
    test('keeps nested and repeated child streams distinct', function (scope) {
        const random = createTestRandom(42n);
        const [ first, second ] = random.split();
        const [ nestedFirst, nestedSecond ] = first.split();
        const [ repeatedFirst, repeatedSecond ] = random.split();
        const streams = [ second, nestedFirst, nestedSecond, repeatedFirst, repeatedSecond ];
        const values = streams.map(function streamValues(stream) {
            return JSON.stringify(draw(stream));
        });
        const uniqueStreams = new Set(values);
        scope.assert.equal(uniqueStreams.size, streams.length);
        return scope.assert.collect();
    }),
    test('produces replayable bytes, UUIDs, and collection choices', function (scope) {
        const first = createTestRandom(42n);
        const replay = createTestRandom(42n);
        scope.assert.deepEqual(first.bytes(32), replay.bytes(32));
        const uuid = first.uuid();
        scope.assert.equal(uuid, replay.uuid());
        scope.assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        scope.assert.equal(first.pick([ 'a', 'b', 'c' ]), replay.pick([ 'a', 'b', 'c' ]));
        return scope.assert.collect();
    }),
    test('supports undefined choices, empty byte buffers, and singleton ranges', function (scope) {
        const random = createTestRandom(42n);
        const choice = random.pick<number | undefined>([ undefined ]);
        scope.assert.undefined(choice);
        scope.assert.deepEqual(random.bytes(0), new Uint8Array());
        scope.assert.equal(random.integer(-5, -5), -5);
        return scope.assert.collect();
    }),
    test('rejects invalid ranges and empty collections', function (scope) {
        const random = createTestRandom(42n);
        for (const [ minimum, maximum ] of [ [ 2, 1 ], [ 0.5, 1 ], [ 0, Number.POSITIVE_INFINITY ] ] as const) {
            scope.assert.throws(function invalidBounds() {
                random.integer(minimum, maximum);
            }, { type: RangeError });
        }
        for (const length of [ -1, 1.5, Number.NaN ]) {
            scope.assert.throws(function invalidLength() {
                random.bytes(length);
            }, { type: RangeError });
        }
        scope.assert.throws(function emptyChoice() {
            random.pick([]);
        }, { type: RangeError });
        return scope.assert.collect();
    }),
    test('preserves case streams across selection, scheduling, and order', async function (scope) {
        const serial = { mode: 'serial-in-process' } as const;
        const full = await executeRandomCases(42n, [ 'first', 'second' ], serial);
        const narrowed = await executeRandomCases(42n, [ 'second' ], serial);
        const concurrent = await executeRandomCases(42n, [ 'second', 'first' ], {
            mode: 'concurrent-in-process',
            maxConcurrency: 2
        });
        scope.assert.deepEqual(caseEvidence(narrowed, 'second'), caseEvidence(full, 'second'));
        scope.assert.deepEqual(caseEvidence(concurrent, 'first'), caseEvidence(full, 'first'));
        scope.assert.deepEqual(caseEvidence(concurrent, 'second'), caseEvidence(full, 'second'));
        scope.assert.notDeepEqual(caseEvidence(full, 'first'), caseEvidence(full, 'second'));
        return scope.assert.collect();
    }),
    test('uses every bit of a large campaign seed', async function (scope) {
        const serial = { mode: 'serial-in-process' } as const;
        const first = await executeRandomCases(42n, [ 'case' ], serial);
        const second = await executeRandomCases(42n + 2n ** 64n, [ 'case' ], serial);
        scope.assert.notDeepEqual(caseEvidence(first, 'case'), caseEvidence(second, 'case'));
        return scope.assert.collect();
    }),
    test('resets the stream for each retry and supports throwing bodies', async function (scope) {
        const engine = createTestEngine();
        const observations: RandomEvidence[] = [];
        const result = await engine.execute(
            engine.createTestPlan(engine.createRoot({
                title: 'retry random',
                annotations: {},
                controls: {},
                children: [ engine.createThrowingTestCase({
                    title: 'case',
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    body(testScope) {
                        observations.push({ seed: testScope.seed.toString(), values: draw(testScope.random) });
                        testScope.assert.true(observations.length > 1);
                    }
                }) ]
            })),
            {
                seed: 42n,
                execution: { mode: 'serial-in-process' },
                retryPolicy: { maxAttempts: 2 },
                reporters: [],
                runFacts: {},
                startedAt: '1970-01-01T00:00:00.000Z'
            }
        );
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(observations.length, 2);
        scope.assert.deepEqual(observations.slice(0, 1), observations.slice(1));
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
