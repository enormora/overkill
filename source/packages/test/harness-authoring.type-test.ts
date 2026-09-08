import { describe, expect, test } from 'tstyche';
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

function assertObjectHarnessTypes(
    objectHarness: DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
): void {
    expect(objectHarness.create()).type.toBe<TypeHarnessCreated>();
    expect(objectHarness.create({})).type.toBe<TypeHarnessCreated>();
    expect(objectHarness.create({
        loadValue(id) {
            return id;
        }
    }))
        .type
        .toBe<TypeHarnessCreated>();
}

function assertObjectHarnessRejections(
    objectHarness: DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
): void {
    const badVariableOverride = {
        loadValue(id: string) {
            return id;
        },
        missing: true
    };

    expect(objectHarness.create).type.not.toBeCallableWith({ missing: true });
    expect(objectHarness.create).type.not.toBeCallableWith(badVariableOverride);
}

describe('@overkill-dev/test defineHarness()', function () {
    test('defines object-form harnesses with exact sparse overrides', function () {
        const objectHarness = defineHarness(partFactories, createSubject);

        expect<typeof objectHarness>().type.toBeAssignableTo<
            DefinedHarness<HarnessOverrides<TypeHarnessParts>, TypeHarnessCreated>
        >();
        assertObjectHarnessTypes(objectHarness);
        assertObjectHarnessRejections(objectHarness);
        expect<typeof partFactories>().type.toBeAssignableTo<HarnessPartFactories>();
        expect<HarnessPartFactory<string>>().type.toBe<() => string>();
        expect<HarnessParts<typeof partFactories>>().type.toBe<TypeHarnessParts>();
        expect<HarnessOverrides<TypeHarnessParts>>().type.toBe<TypeObjectHarnessOverrides>();
        expect<{ readonly missing: true; }>()
            .type
            .not
            .toBeAssignableTo<ExactHarnessOverrides<{ readonly missing: true; }, TypeObjectHarnessOverrides>>();
    });

    test('defines function-form harnesses with sparse typed overrides', function () {
        const syncHarness = defineHarness(createLabel);
        const asyncHarness = defineHarness(createAsyncLabel);
        const badVariableOverride = { label: 'bad', missing: true };

        expect(syncHarness.create()).type.toBe<TypeLabelHarness>();
        expect(syncHarness.create({ label: 'custom' })).type.toBe<TypeLabelHarness>();
        expect(syncHarness.create).type.not.toBeCallableWith({ missing: true });
        expect(syncHarness.create).type.not.toBeCallableWith(badVariableOverride);
        expect(asyncHarness.create()).type.toBe<Promise<TypeLabelHarness>>();
        expect(defineHarness).type.not.toBeCallableWith(createInvalidHarness);
    });
});
