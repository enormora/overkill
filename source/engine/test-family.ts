import type { Except } from 'type-fest';
import { z } from 'zod/v4';
import type { ModuleReference } from '../implementation-reference.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { snapshotPortableValue, type PortableValue } from '../portable-value.ts';
import type { TestPlan } from './test-plan.ts';
import type { WorkId, TestFamilyId } from './identity.ts';
import type { PerTestResult, RunArtifact, RunnerError } from './run-result.ts';

const familyBrand: unique symbol = Symbol('TestFamily');
const familyDefinitionsKey = Symbol.for('@overkill-dev/engine/TestFamilyDefinitions');
const familyBindingsKey = Symbol.for('@overkill-dev/engine/TestFamilyBindings');
const issuedBindingsKey = Symbol.for('@overkill-dev/engine/IssuedFamilyBindings');

function familyDefinitions(): WeakSet<DefinedTestFamily> {
    const existing: unknown = Reflect.get(globalThis, familyDefinitionsKey);
    if (existing instanceof WeakSet) {
        return existing;
    }
    const definitions = new WeakSet<DefinedTestFamily>();
    Reflect.set(globalThis, familyDefinitionsKey, definitions);
    return definitions;
}
export type BoundFamilySettings = {
    readonly testFamily: DefinedTestFamily;
    readonly settings: FamilyValue;
    readonly prepare: (input: Except<FamilyPreparationInput<FamilyValue>, 'settings'>) => Promise<FamilyPreparation>;
};

type FamilySettingsBinder = (input: unknown) => BoundFamilySettings;

function isFamilyBindingRegistry(value: unknown): value is WeakMap<DefinedTestFamily, FamilySettingsBinder> {
    return value instanceof WeakMap;
}

function familyBindings(): WeakMap<DefinedTestFamily, FamilySettingsBinder> {
    const existing: unknown = Reflect.get(globalThis, familyBindingsKey);
    if (isFamilyBindingRegistry(existing)) {
        return existing;
    }
    const bindings = new WeakMap<DefinedTestFamily, FamilySettingsBinder>();
    Reflect.set(globalThis, familyBindingsKey, bindings);
    return bindings;
}

function issuedFamilyBindings(): WeakSet<BoundFamilySettings> {
    const existing: unknown = Reflect.get(globalThis, issuedBindingsKey);
    if (existing instanceof WeakSet) {
        return existing;
    }
    const bindings = new WeakSet<BoundFamilySettings>();
    Reflect.set(globalThis, issuedBindingsKey, bindings);
    return bindings;
}

export function isBoundFamilySettings(binding: BoundFamilySettings): boolean {
    return issuedFamilyBindings().has(binding);
}

export function bindFamilySettings(family: DefinedTestFamily, input: unknown): BoundFamilySettings {
    const bind = familyBindings().get(family);
    if (bind === undefined) {
        throw new TypeError('Settings require a defined test family.');
    }
    const binding = bind(input);
    issuedFamilyBindings().add(binding);
    return binding;
}

export type FamilyValue = PortableValue;

export type FamilyModuleReference = ModuleReference;

export type FamilyFeatures = {
    readonly execution: 'analysis' | 'runtime';
    readonly processModels: NonEmptyReadonlyArray<'in-process' | 'supervised-process' | 'worker-pool'>;
    readonly profileOptions: readonly ('capture' | 'coverage' | 'resources' | 'retries')[];
};

export type TestFamilyDefinition<Settings extends FamilyValue> = {
    readonly id: TestFamilyId;
    readonly version: string;
    readonly module: FamilyModuleReference | null;
    readonly features: FamilyFeatures;
    readonly parseSettings: (input: unknown) => Settings;
    readonly load: () => Promise<FamilyBackend<Settings>>;
};

export type DefinedTestFamily = {
    readonly [familyBrand]: true;
    readonly id: TestFamilyId;
    readonly version: string;
    readonly module: FamilyModuleReference | null;
    readonly features: FamilyFeatures;
};

export type TestFamily<Settings extends FamilyValue> = DefinedTestFamily & TestFamilyDefinition<Settings>;

export type FamilyVariant = {
    readonly key: string;
    readonly facts: FamilyValue;
};

export type FamilyPreparationInput<Settings extends FamilyValue> = {
    readonly testPlan: TestPlan;
    readonly settings: Settings;
    readonly projectRoot: string;
    readonly signal: AbortSignal;
    readonly expandVariants: (variants: NonEmptyReadonlyArray<FamilyVariant>) => TestPlan;
};

export type FamilyBackend<Settings extends FamilyValue> = {
    readonly prepare: (input: FamilyPreparationInput<Settings>) => Promise<FamilyPreparation>;
};

export type FamilyPreparation = {
    readonly testPlan: TestPlan;
    readonly facts: FamilyValue;
    readonly collect: (input: FamilyCollectionInput) => Promise<FamilyCollection>;
    readonly dispose: () => Promise<void>;
};

export type FamilyCollectionInput = {
    readonly workIds: readonly WorkId[];
    readonly signal: AbortSignal;
};

type RuntimeCollection = { readonly kind: 'runtime'; readonly facts: FamilyValue; };
type AnalysisCollection = {
    readonly kind: 'analysis';
    readonly facts: FamilyValue;
    readonly execute: (context: FamilyAnalysisContext) => Promise<void>;
};
export type FamilyCollection = AnalysisCollection | RuntimeCollection;

type FamilyEvents = {
    readonly artifact: { readonly kind: 'artifact'; readonly artifact: RunArtifact; };
    readonly caseEnd: {
        readonly kind: 'case-end';
        readonly result: PerTestResult;
        readonly artifacts: readonly RunArtifact[];
    };
    readonly caseProgress: { readonly kind: 'case-progress'; readonly workId: WorkId; readonly note: string; };
    readonly caseStart: { readonly kind: 'case-start'; readonly workId: WorkId; };
    readonly runError: { readonly kind: 'run-error'; readonly error: RunnerError; };
};
export type FamilyEvent = FamilyEvents[keyof FamilyEvents];

export type FamilyAnalysisContext = {
    readonly signal: AbortSignal;
    readonly report: (event: FamilyEvent) => Promise<void>;
};

export function snapshotFamilyValue<Value extends FamilyValue>(value: Value): Value {
    try {
        return snapshotPortableValue(value);
    } catch (error: unknown) {
        throw new TypeError('Family settings require lossless, acyclic JSON.', { cause: error });
    }
}

const metadataSchema = z.object({
    id: z.string().refine(function (value) {
        return value.trim().length > 0;
    }),
    version: z.string().refine(function (value) {
        return value.trim().length > 0;
    }),
    module: z.strictObject({ moduleUrl: z.url(), exportName: z.string().min(1) }).nullable(),
    features: z.strictObject({
        execution: z.enum([ 'runtime', 'analysis' ]),
        processModels: z
            .tuple([ z.enum([ 'in-process', 'supervised-process', 'worker-pool' ]) ])
            .rest(z.enum([ 'in-process', 'supervised-process', 'worker-pool' ])),
        profileOptions: z.array(z.enum([ 'coverage', 'capture', 'resources', 'retries' ]))
    }),
    parseSettings: z.custom<(...arguments_: readonly never[]) => unknown>(function (value) {
        return typeof value === 'function';
    }),
    load: z.custom<(...arguments_: readonly never[]) => unknown>(function (value) {
        return typeof value === 'function';
    })
});

export function isDefinedTestFamily(value: unknown): value is DefinedTestFamily {
    const definitions: unknown = Reflect.get(globalThis, familyDefinitionsKey);
    return definitions instanceof WeakSet && typeof value === 'object' && value !== null && definitions.has(value);
}

export function defineTestFamily<Settings extends FamilyValue>(
    definition: TestFamilyDefinition<Settings>
): TestFamily<Settings> {
    const metadata = metadataSchema.parse(definition);
    if (metadata.features.execution === 'analysis' && metadata.features.profileOptions.length > 0) {
        throw new TypeError('Analysis families cannot enable runtime profile options.');
    }
    const parse = definition.parseSettings;
    const { load } = definition;
    const family: TestFamily<Settings> = {
        [familyBrand]: true,
        id: metadata.id,
        version: metadata.version,
        module: metadata.module === null ? null : Object.freeze(metadata.module),
        features: Object.freeze({
            ...metadata.features,
            processModels: Object.freeze(metadata.features.processModels),
            profileOptions: Object.freeze(metadata.features.profileOptions)
        }),
        parseSettings(input) {
            const parsed = parse(input);
            return snapshotFamilyValue(parsed);
        },
        load
    };
    familyBindings().set(family, function bind(input) {
        const settings = family.parseSettings(input);
        return Object.freeze({
            testFamily: family,
            settings,
            async prepare(preparationInput) {
                const backend = await family.load();
                preparationInput.signal.throwIfAborted();
                return await backend.prepare({ ...preparationInput, settings });
            }
        });
    });
    familyDefinitions().add(family);
    return Object.freeze(family);
}
