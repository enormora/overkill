import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import { normalizeConfig } from '../config/config.ts';
import { createDeterministicRunCoordinator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { analysisFixture, type EvidenceMode } from '../test-support/family-analysis-fixture.ts';
import type { TestPlan, Engine } from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { testNode as familyPolicy } from './family-profile-policy.test.ts';
import type { RunCommand } from './run-types.ts';

function fixtureCommand(record: (event: string) => void, mode: EvidenceMode): RunCommand {
    return {
        config: normalizeConfig({
            profiles: {
                types: {
                    testFamily: analysisFixture(record, mode),
                    settings: null,
                    files: { include: [ 'source/native.types.ts' ] }
                }
            }
        }),
        cwd: '/project',
        engine: { kind: 'default' as const },
        request: defaultRunRequest({ profile: 'types', paths: [ 'source/native.types.ts' ], order: 'plan' })
    };
}

function analysisPlan(engine: Engine): TestPlan {
    const options = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] as const };
    const node = engine.createTestCase({
        ...options,
        title: 'static',
        body() {
            throw new Error('Body invoked.');
        }
    });
    return engine.createTestPlan(engine.createRoot({ ...options, title: 'root', children: [ node ] }));
}

export const testNode = suite('family profile execution', [
    familyPolicy,
    test('executes imported analysis through engine evidence and disposal', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const result = await coordinator.orchestrator.run(fixtureCommand(function record(event) {
            events.push(event);
        }, 'complete'));
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'collect', 'execute', 'dispose' ]);
        scope.assert.equal(result.summary.inconclusive, 0);
        return scope.assert.collect();
    }),
    test('creates fresh single-use preparations for collected invocations', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        const initialized = await coordinator.orchestrator.initialize(fixtureCommand(function record(event) {
            events.push(event);
        }, 'complete'));
        const collected = await initialized.collect();
        const first = await collected.run({ selection: { kind: 'all' } });
        const second = await collected.run({ selection: { kind: 'all' } });
        scope.assert.deepEqual([ first.status, second.status ], [ 'passed', 'passed' ]);
        scope.assert.equal(
            events
                .filter(function (event) {
                    return event === 'prepare';
                })
                .length,
            3
        );
        scope.assert.equal(
            events
                .filter(function (event) {
                    return event === 'dispose';
                })
                .length,
            3
        );
        return scope.assert.collect();
    }),
    ...([ 'missing', 'duplicate' ] as const).map(function (mode) {
        return test(`rejects ${mode} backend evidence`, async function (scope) {
            const events: string[] = [];
            const coordinator = createDeterministicRunCoordinator();
            const result = await coordinator.orchestrator.run(fixtureCommand(function record(event) {
                events.push(event);
            }, mode));
            scope.assert.equal(result.status, 'failed');
            scope.assert.true(result.runnerErrors.length > 0);
            scope.assert.true(result.summary.inconclusive > 0);
            scope.assert.equal(events.at(-1), 'dispose');
            return scope.assert.collect();
        });
    }),
    test('disposes inspection-only preparations', async function (scope) {
        const events: string[] = [];
        const coordinator = createDeterministicRunCoordinator();
        await coordinator.orchestrator.resolve(fixtureCommand(function record(event) {
            events.push(event);
        }, 'complete'));
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'collect', 'dispose' ]);
        return scope.assert.collect();
    }),
    test('keeps direct engine analysis below runner configuration and runtime bodies', async function (scope) {
        const events: string[] = [];
        const engine = createTestEngine();
        const plan = analysisPlan(engine);
        const { signal } = new AbortController();
        await using prepared = await engine.prepareFamily({
            testPlan: plan,
            testFamily: analysisFixture(function (event) {
                events.push(event);
            }, 'complete'),
            settings: null,
            projectRoot: '/project',
            signal
        });
        const collected = await prepared.collect({
            workIds: prepared.testPlan.cases.map(function (entry) {
                return entry.workId;
            }),
            signal
        });
        const result = await engine.execute(collected, {
            signal,
            debug: { mode: 'off' },
            execution: { mode: 'serial-in-process' },
            retryPolicy: null,
            reporters: [],
            runFacts: {},
            startedAt: '2026-01-01T00:00:00.000Z'
        });
        scope.assert.equal(result.status, 'passed');
        scope.assert.deepEqual(events, [ 'load', 'prepare', 'collect', 'execute', 'dispose' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
