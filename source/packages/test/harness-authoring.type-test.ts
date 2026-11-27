import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { assignableTo, rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
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
                assignableTo<
                    typeof objectHarness,
                    DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
                >()
            );
            typeScope.assert(sameType.withActual<TypeHarnessCreated>(), objectHarness.create());
            typeScope.assert(sameType.withActual<TypeHarnessCreated>(), objectHarness.create({}));
            typeScope.assert(
                sameType.withActual<TypeHarnessCreated>(),
                objectHarness.create({
                    loadValue(id) {
                        return id;
                    }
                })
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
            typeScope.assert(assignableTo<typeof partFactories, HarnessPartFactories>());
            typeScope.assert(sameType<HarnessPartFactory<string>, () => string>());
            typeScope.assert(sameType<HarnessParts<typeof partFactories>, TypeHarnessParts>());
            typeScope.assert(sameType<HarnessOverrides<TypeHarnessParts>, TypeObjectHarnessOverrides>());
            typeScope.assert(
                assignableTo.not<
                    { readonly missing: true; },
                    ExactHarnessOverrides<{ readonly missing: true; }, TypeObjectHarnessOverrides>
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    test('defines function-form harnesses with sparse typed overrides', function (typeScope) {
        const syncHarness = defineHarness(createLabel);
        const asyncHarness = defineHarness(createAsyncLabel);
        const badVariableOverride = { label: 'bad', missing: true };

        typeScope.assert(sameType.withActual<TypeLabelHarness>(), syncHarness.create());
        typeScope.assert(sameType.withActual<TypeLabelHarness>(), syncHarness.create({ label: 'custom' }));
        typeScope.assert(rejectsCall('argument-type'), () => syncHarness.create({ missing: true }));
        typeScope.assert(rejectsCall('argument-type'), () => syncHarness.create(badVariableOverride));
        typeScope.assert(sameType.withActual<Promise<TypeLabelHarness>>(), asyncHarness.create());
        typeScope.assert(rejectsCall('argument-count'), () => defineHarness(createInvalidHarness));
        return typeScope.assert.collect();
    })
]);
