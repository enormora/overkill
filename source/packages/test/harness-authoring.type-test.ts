import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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

export const testNode = suite('@overkill-dev/test defineHarness()', [
    suite('defines object-form harnesses with exact sparse overrides', [
        test('types the harness and its creation forms', function (typeScope) {
            const objectHarness = defineHarness(partFactories, createSubject);
            typeScope.assert(
                sameType<
                    IsAssignable<
                        typeof objectHarness,
                        DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
                    >,
                    true
                >()
            );
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TypeHarnessCreated>()(objectHarness.create()));
            typeScope.assert(sameType.withActual<true>(), isEqualTo<TypeHarnessCreated>()(objectHarness.create({})));
            typeScope.assert(
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
            typeScope.assert(rejectsCall('argument-type'), () => objectHarness.create({ missing: true }));
            typeScope.assert(rejectsCall('argument-type'), () => objectHarness.create(badVariableOverride));
            return typeScope.assert.collect();
        }),
        test('rejects unknown overrides', function (typeScope) {
            typeScope.assert(sameType<IsAssignable<typeof partFactories, HarnessPartFactories>, true>());
            typeScope.assert(sameType<IsEqual<HarnessPartFactory<string>, () => string>, true>());
            typeScope.assert(sameType<IsEqual<HarnessParts<typeof partFactories>, TypeHarnessParts>, true>());
            typeScope.assert(sameType<IsEqual<HarnessOverrides<TypeHarnessParts>, TypeObjectHarnessOverrides>, true>());
            typeScope.assert(
                sameType<
                    IsAssignable<
                        { readonly missing: true; },
                        ExactHarnessOverrides<{ readonly missing: true; }, TypeObjectHarnessOverrides>
                    >,
                    false
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    test('defines function-form harnesses with sparse typed overrides', function (typeScope) {
        const syncHarness = defineHarness(createLabel);
        const asyncHarness = defineHarness(createAsyncLabel);
        const badVariableOverride = { label: 'bad', missing: true };

        typeScope.assert(sameType.withActual<true>(), isEqualTo<TypeLabelHarness>()(syncHarness.create()));
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<TypeLabelHarness>()(syncHarness.create({ label: 'custom' }))
        );
        typeScope.assert(rejectsCall('argument-type'), () => syncHarness.create({ missing: true }));
        typeScope.assert(rejectsCall('argument-type'), () => syncHarness.create(badVariableOverride));
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Promise<TypeLabelHarness>>()(asyncHarness.create()));
        typeScope.assert(rejectsCall('argument-count'), () => defineHarness(createInvalidHarness));
        return typeScope.assert.collect();
    })
]);
