import {
    type TestNode,
    suite,
    test,
    type TestScope,
    doubleUsage,
    type TestDouble,
    testDouble
} from '@overkill-dev/test';

import { defineHarness, type DefinedHarness, type HarnessOverrides } from './test.entry-point.ts';

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

export const testNode: TestNode = suite('Harness authoring', [
    test('creates fresh object-form harnesses', function (scope) {
        let loadFactoryCalls = 0;
        const runnerHarness = createFreshRunnerHarness(function recordLoadFactoryCall() {
            loadFactoryCalls += 1;
        });
        const first = runnerHarness.create();
        const second = runnerHarness.create();

        first.subject('id');

        assertFreshHarnesses(scope, loadFactoryCalls, first, second);

        return scope.assert.collect();
    }),
    test('replaces overridden object-form parts', function (scope) {
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
    }),
    test(
        'supports sync and async function forms',
        async function (scope) {
            const syncHarness = createSyncLabelHarness();
            const asyncHarness = createAsyncLabelHarness();

            scope.assert.deepEqual(syncHarness.create(), { label: 'default' });
            scope.assert.deepEqual(syncHarness.create({ label: 'sync' }), { label: 'sync' });
            scope.assert.deepEqual(await asyncHarness.create({ label: 'async' }), { label: 'async' });

            return scope.assert.collect();
        }
    )
]);
