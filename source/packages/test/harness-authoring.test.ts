import { createSuite, createTestCase, type TestScope } from '../engine/engine.entry-point.ts';
import {
    defineHarness,
    doubleUsage,
    type DefinedHarness,
    type HarnessOverrides,
    type TestDouble,
    testDouble
} from './test.entry-point.ts';

type HarnessLoadValue = (id: string) => string;

type FreshEvents = {
    readonly marker: symbol;
};

type FreshRunnerParts = {
    readonly events: FreshEvents;
    readonly loadValue: TestDouble<HarnessLoadValue>;
};

type FreshRunnerHarness = FreshRunnerParts & {
    readonly subject: (id: string) => void;
};

type OverrideRunnerParts = {
    readonly loadValue: TestDouble<HarnessLoadValue>;
};

type OverrideRunnerHarness = OverrideRunnerParts & {
    readonly subject: (id: string) => string;
};

type LabelHarnessOverrides = {
    readonly label?: string;
};

type LabelHarness = {
    readonly label: string;
};

function createHarnessLoadValue(value: string): TestDouble<HarnessLoadValue> {
    return testDouble.returns<HarnessLoadValue>(value);
}

function createFreshRunnerHarness(
    recordLoadFactoryCall: () => void
): DefinedHarness<HarnessOverrides<FreshRunnerParts>, FreshRunnerHarness> {
    return defineHarness({
        loadValue() {
            recordLoadFactoryCall();

            return createHarnessLoadValue('default');
        },
        events() {
            return { marker: Symbol('events') };
        }
    }, function assembleRunner(parts): FreshRunnerHarness {
        return {
            subject(id) {
                parts.loadValue(id);
            },
            ...parts
        };
    });
}

function createOverrideRunnerHarness(
    recordDefaultFactoryCall: () => void
): DefinedHarness<HarnessOverrides<OverrideRunnerParts>, OverrideRunnerHarness> {
    return defineHarness({
        loadValue() {
            recordDefaultFactoryCall();

            return createHarnessLoadValue('default');
        }
    }, function assembleRunner(parts): OverrideRunnerHarness {
        return {
            subject(id) {
                return parts.loadValue(id);
            },
            ...parts
        };
    });
}

function createSyncLabelHarness(): DefinedHarness<LabelHarnessOverrides, LabelHarness> {
    return defineHarness(function createLabel(overrides: LabelHarnessOverrides): LabelHarness {
        return { label: overrides.label ?? 'default' };
    });
}

function createAsyncLabelHarness(): DefinedHarness<LabelHarnessOverrides, Promise<LabelHarness>> {
    return defineHarness(async function createAsyncLabel(overrides: LabelHarnessOverrides): Promise<LabelHarness> {
        return { label: overrides.label ?? 'default' };
    });
}

function assertFreshHarnesses(
    scope: TestScope,
    loadFactoryCalls: number,
    first: FreshRunnerHarness,
    second: FreshRunnerHarness
): void {
    scope.assert.equal(loadFactoryCalls, 2);
    scope.assert.notEqual(first.loadValue, second.loadValue);
    scope.assert.notEqual(first.events, second.events);
    scope.assert(doubleUsage.calledOnceWith, first.loadValue, [ 'id' ]);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/harness-authoring.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test defineHarness() creates fresh object-form harnesses',
            metadata: {},
            body(scope: TestScope) {
                let loadFactoryCalls = 0;
                const runnerHarness = createFreshRunnerHarness(function recordLoadFactoryCall() {
                    loadFactoryCalls += 1;
                });
                const first = runnerHarness.create();
                const second = runnerHarness.create();

                first.subject('id');

                assertFreshHarnesses(scope, loadFactoryCalls, first, second);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test defineHarness() replaces overridden object-form parts',
            metadata: {},
            body(scope: TestScope) {
                let defaultFactoryCalls = 0;
                const replacementLoadValue = createHarnessLoadValue('replacement');
                const runnerHarness = createOverrideRunnerHarness(function recordDefaultFactoryCall() {
                    defaultFactoryCalls += 1;
                });
                const harness = runnerHarness.create({ loadValue: replacementLoadValue });

                scope.assert.equal(defaultFactoryCalls, 0);
                scope.assert.equal(harness.loadValue, replacementLoadValue);
                scope.assert.equal(harness.subject('id'), 'replacement');
                scope.assert(doubleUsage.calledOnceWith, replacementLoadValue, [ 'id' ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: '@overkill-dev/test defineHarness() supports sync and async function forms',
            metadata: {},
            async body(scope: TestScope) {
                const syncHarness = createSyncLabelHarness();
                const asyncHarness = createAsyncLabelHarness();

                scope.assert.deepEqual(syncHarness.create(), { label: 'default' });
                scope.assert.deepEqual(syncHarness.create({ label: 'sync' }), { label: 'sync' });
                scope.assert.deepEqual(await asyncHarness.create({ label: 'async' }), { label: 'async' });

                return scope.assert.collect();
            }
        })
    ]
});
