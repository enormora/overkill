export type HarnessPartFactory<Part> = () => Part;

export type HarnessPartFactories = Readonly<Record<string, HarnessPartFactory<unknown>>>;

export type HarnessParts<Factories extends HarnessPartFactories> = {
    readonly [PartName in keyof Factories]: ReturnType<Factories[PartName]>;
};

export type HarnessOverrides<Parts extends Readonly<Record<string, unknown>>> = {
    readonly [PartName in keyof Parts]?: Parts[PartName];
};

export type ExactHarnessOverrides<
    Candidate extends Readonly<Record<string, unknown>>,
    Shape extends Readonly<Record<string, unknown>>
> = Candidate & Readonly<Record<Exclude<keyof Candidate, keyof Shape>, never>>;

export type DefinedHarness<OverrideShape extends Readonly<Record<string, unknown>>, CreatedHarness> = {
    readonly create: {
        (): CreatedHarness;
        <Candidate extends OverrideShape>(overrides: ExactHarnessOverrides<Candidate, OverrideShape>): CreatedHarness;
    };
};

type RequiredPartName<Shape extends Readonly<Record<string, unknown>>> = {
    readonly [PartName in keyof Shape]-?: Pick<Shape, PartName> extends Required<Pick<Shape, PartName>> ? PartName
        : never;
}[keyof Shape];

type SparseOverrideShape<Shape extends Readonly<Record<string, unknown>>> = RequiredPartName<Shape> extends never
    ? Shape
    : never;

type RuntimePartFactories = Readonly<Record<string, () => unknown>>;
type RuntimeCreatedHarness = Readonly<Record<string, unknown>>;
type RuntimeHarnessAssembler = (parts: RuntimeCreatedHarness) => unknown;
type RuntimeHarnessFactory = (overrides: RuntimeCreatedHarness) => unknown;

function createHarnessParts(
    partFactories: RuntimePartFactories,
    overrides: RuntimeCreatedHarness
): RuntimeCreatedHarness {
    const parts: Record<string, unknown> = {};

    for (const [ name, createPart ] of Object.entries(partFactories)) {
        parts[name] = Object.hasOwn(overrides, name) ? overrides[name] : createPart();
    }

    return parts;
}

function assembleHarness(
    assemble: RuntimeHarnessAssembler | undefined,
    parts: RuntimeCreatedHarness
): unknown {
    return assemble?.(parts);
}

export function defineHarness<OverrideShape extends Readonly<Record<string, unknown>>, CreatedHarness>(
    factory: (overrides: OverrideShape) => CreatedHarness,
    ...requiredOverrideFields: RequiredPartName<OverrideShape> extends never ? readonly [] : readonly [never]
): DefinedHarness<SparseOverrideShape<OverrideShape>, CreatedHarness>;
export function defineHarness<const Factories extends HarnessPartFactories, CreatedHarness>(
    partFactories: Factories,
    assemble: (parts: HarnessParts<Factories>) => CreatedHarness
): DefinedHarness<HarnessOverrides<HarnessParts<Factories>>, CreatedHarness>;
export function defineHarness(
    partFactoriesOrFactory: RuntimeHarnessFactory | RuntimePartFactories,
    assemble?: RuntimeHarnessAssembler
): DefinedHarness<Readonly<Record<string, unknown>>, unknown> {
    if (typeof partFactoriesOrFactory === 'function') {
        return {
            create(overrides: RuntimeCreatedHarness = {}) {
                return partFactoriesOrFactory(overrides);
            }
        };
    }

    return {
        create(overrides: RuntimeCreatedHarness = {}) {
            return assembleHarness(assemble, createHarnessParts(partFactoriesOrFactory, overrides));
        }
    };
}
