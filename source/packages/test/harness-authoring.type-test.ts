import type { IsEqual } from 'type-fest';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import { suite, test } from '@overkill-dev/test';
import { type IsAssignable, isEqualTo } from '../../test-support/type-relations.ts';
import {
    type DefinedHarness,
    type ExactHarnessOverrides,
    defineHarness,
    type HarnessOverrides,
    type HarnessPartFactories,
    type HarnessPartFactory,
    type HarnessParts
} from './test.entry-point.ts';

type TypeHarnessLoadValue = (id: string) => string;

type TypeHarnessParts = {
    readonly events: readonly string[];
    readonly loadValue: TypeHarnessLoadValue;
};

type TypeObjectHarnessOverrides = {
    readonly events?: readonly string[];
    readonly loadValue?: TypeHarnessLoadValue;
};

type TypeFunctionHarnessOverrides = {
    readonly label?: string;
    readonly loadValue?: TypeHarnessLoadValue;
};

type TypeHarnessWithRequiredOverrides = {
    readonly label: string;
};

type TypeHarnessCreated = {
    readonly events: readonly string[];
    readonly loadValue: TypeHarnessLoadValue;
    readonly subject: (id: string) => string;
};

type TypeLabelHarness = {
    readonly label: string;
    readonly loadValue: TypeHarnessLoadValue;
};

const partFactories = {
    events(): readonly string[] {
        return [ 'created' ];
    },
    loadValue(): TypeHarnessLoadValue {
        return function loadValue(id) {
            return id;
        };
    }
};

function createSubject(parts: TypeHarnessParts): TypeHarnessCreated {
    return {
        subject(id) {
            return parts.loadValue(id);
        },
        ...parts
    };
}

function createLabel(overrides: TypeFunctionHarnessOverrides): TypeLabelHarness {
    return {
        label: overrides.label ?? 'default',
        loadValue: overrides.loadValue ?? function loadValue(id) {
            return id;
        }
    };
}

async function createAsyncLabel(overrides: TypeFunctionHarnessOverrides): Promise<TypeLabelHarness> {
    const loadValue = overrides.loadValue ?? function loadValue(id) {
        return id;
    };

    return {
        label: overrides.label ?? 'default',
        loadValue
    };
}

function createInvalidHarness(overrides: TypeHarnessWithRequiredOverrides): string {
    return overrides.label;
}

export const testNode = suite('Harness composition and sparse overrides', [
    suite('defines object-form harnesses with exact sparse overrides', [
        test('types the harness and its creation forms', function (scope) {
            const objectHarness = defineHarness(partFactories, createSubject);
            scope.assert(
                sameType<
                    IsAssignable<
                        typeof objectHarness,
                        DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
                    >,
                    true
                >()
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<TypeHarnessCreated>()(objectHarness.create()));
            scope.assert(sameType.withActual<true>(), isEqualTo<TypeHarnessCreated>()(objectHarness.create({})));
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TypeHarnessCreated>()(objectHarness.create({
                    loadValue(id) {
                        return id;
                    }
                }))
            );
            const badVariableOverride = {
                loadValue(id: string) {
                    return id;
                },
                missing: true
            };
            scope.assert(rejectsCall('argument-type'), function () {
                return objectHarness.create({ missing: true });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return objectHarness.create(badVariableOverride);
            });
            return scope.assert.collect();
        }),
        test('rejects unknown overrides', function (scope) {
            scope.assert(sameType<IsAssignable<typeof partFactories, HarnessPartFactories>, true>());
            scope.assert(sameType<IsEqual<HarnessPartFactory<string>, () => string>, true>());
            scope.assert(sameType<IsEqual<HarnessParts<typeof partFactories>, TypeHarnessParts>, true>());
            scope.assert(sameType<IsEqual<HarnessOverrides<TypeHarnessParts>, TypeObjectHarnessOverrides>, true>());
            scope.assert(
                sameType<
                    IsAssignable<
                        { readonly missing: true; },
                        ExactHarnessOverrides<{ readonly missing: true; }, TypeObjectHarnessOverrides>
                    >,
                    false
                >()
            );
            return scope.assert.collect();
        })
    ]),
    test('defines function-form harnesses with sparse typed overrides', function (scope) {
        const syncHarness = defineHarness(createLabel);
        const asyncHarness = defineHarness(createAsyncLabel);
        const badVariableOverride = { label: 'bad', missing: true };

        scope.assert(sameType.withActual<true>(), isEqualTo<TypeLabelHarness>()(syncHarness.create()));
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<TypeLabelHarness>()(syncHarness.create({ label: 'custom' }))
        );
        scope.assert(rejectsCall('argument-type'), function () {
            return syncHarness.create({ missing: true });
        });
        scope.assert(rejectsCall('argument-type'), function () {
            return syncHarness.create(badVariableOverride);
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<Promise<TypeLabelHarness>>()(asyncHarness.create()));
        scope.assert(rejectsCall('argument-count'), function () {
            return defineHarness(createInvalidHarness);
        });
        return scope.assert.collect();
    })
]);
