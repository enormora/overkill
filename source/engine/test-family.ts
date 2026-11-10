import { z } from 'zod/v4';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { snapshotValidatedJson } from '../attachments/json-snapshot.ts';
import type { TestPlan } from './test-plan.ts';
import type { WorkId, TestFamilyId } from './identity.ts';
import type { PerTestResult, RunArtifact, RunnerError } from './run-result.ts';

const familyBrand: unique symbol = Symbol('TestFamily');
const definitions = new WeakSet();
type FamilyScalar = boolean | number | string | null;
type FamilyArray = readonly FamilyValue[];
type FamilyRecord = { readonly [key: string]: FamilyValue; };
export type FamilyValue = FamilyArray | FamilyRecord | FamilyScalar;

export type FamilyModuleReference = {
    readonly moduleUrl: string;
    readonly exportName: string;
};

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

function validateDataProperty(value: unknown, key: PropertyKey): void {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('Family settings require enumerable string data properties.');
    }
}

function validateArrayProperty(value: readonly unknown[], key: PropertyKey): void {
    if (key === 'length') {
        return;
    }
    validateDataProperty(value, key);
    if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/v.test(key) || Number(key) >= value.length) {
        throw new TypeError('Family arrays cannot contain additional properties.');
    }
}

function validateFamilyValue(value: unknown): void {
    if (Object.is(value, -0)) {
        throw new TypeError('Family settings require lossless JSON numbers.');
    }
    if (typeof value !== 'object' || value === null) {
        return;
    }
    if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
            throw new TypeError('Family settings require ordinary JSON arrays.');
        }
        Reflect.ownKeys(value).forEach(function validateKey(key) {
            validateArrayProperty(value, key);
        });
        return;
    }
    Reflect.ownKeys(value).forEach(function validateKey(key) {
        validateDataProperty(value, key);
    });
}

function freezeSettings(value: FamilyValue): void {
    if (typeof value === 'object' && value !== null) {
        Object.values(value).forEach(freezeSettings);
        Object.freeze(value);
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
    return typeof value === 'object' && value !== null && definitions.has(value);
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
            try {
                snapshotValidatedJson(parsed, validateFamilyValue);
            } catch (error: unknown) {
                throw new TypeError('Family settings require lossless, acyclic JSON.', { cause: error });
            }
            const settings = structuredClone(parsed);
            freezeSettings(settings);
            return settings;
        },
        load
    };
    definitions.add(family);
    return Object.freeze(family);
}
