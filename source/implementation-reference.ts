import { isAbsolute } from 'node:path';
import type { Except } from 'type-fest';
import { z } from 'zod/v4';
import { snapshotPortableValue, type PortableValue } from './portable-value.ts';

export type ModuleReference = {
    readonly moduleUrl: string;
    readonly exportName: string;
};

export type ImplementationRealm = 'browser' | 'host';
export type ImplementationInputContext = { readonly projectRoot: string; };
export type ImplementationReference<Input extends PortableValue> = {
    readonly kind: 'implementation-reference';
    readonly module: ModuleReference;
    readonly realm: ImplementationRealm;
    readonly version: string;
    readonly input: PortableValue;
    readonly parseInput: (input: unknown, context: ImplementationInputContext) => Input;
    readonly dynamicModules: readonly ModuleReference[];
};
export type ImplementationExport<Implementation> = {
    readonly version: string;
    readonly implementation: Implementation;
};
export type ImplementationFacts = {
    readonly module: ModuleReference;
    readonly realm: ImplementationRealm;
    readonly version: string;
    readonly input: PortableValue;
    readonly dynamicModules: readonly ModuleReference[];
};

export const moduleReferenceSchema = z.strictObject({
    moduleUrl: z.url(),
    exportName: z.string().min(1)
});
const referenceMetadataSchema = z.object({
    kind: z.literal('implementation-reference'),
    module: moduleReferenceSchema,
    realm: z.enum([ 'host', 'browser' ]),
    version: z.string().refine(function nonblank(value) {
        return value.trim().length > 0;
    }),
    dynamicModules: z.array(moduleReferenceSchema)
});

export function defineImplementationReference<Input extends PortableValue>(
    reference: Except<ImplementationReference<Input>, 'kind'>
): ImplementationReference<Input> {
    const metadata = referenceMetadataSchema.parse({ ...reference, kind: 'implementation-reference' });
    if (typeof reference.parseInput !== 'function') {
        throw new TypeError('Implementation inputs require a synchronous parser.');
    }
    return Object.freeze({
        ...metadata,
        module: Object.freeze(metadata.module),
        dynamicModules: Object.freeze(metadata.dynamicModules.map(function freezeModule(module) {
            return Object.freeze(module);
        })),
        input: snapshotPortableValue(reference.input),
        parseInput: reference.parseInput
    });
}

export function implementationFacts<Input extends PortableValue>(
    reference: ImplementationReference<Input>,
    context: ImplementationInputContext
): ImplementationFacts {
    if (!isAbsolute(context.projectRoot)) {
        throw new TypeError('Implementation preparation requires an absolute project root.');
    }
    return Object.freeze({
        module: reference.module,
        realm: reference.realm,
        version: reference.version,
        input: snapshotPortableValue(reference.parseInput(reference.input, context)),
        dynamicModules: reference.dynamicModules
    });
}

export function readImplementationExport<Implementation>(
    namespace: unknown,
    facts: ImplementationFacts,
    parseImplementation: (input: unknown) => Implementation
): Implementation {
    const exports = z.record(z.string(), z.unknown()).parse(namespace);
    if (!Object.hasOwn(exports, facts.module.exportName)) {
        throw new TypeError(`Missing implementation export: ${facts.module.exportName}`);
    }
    const exported = z
        .strictObject({ version: z.string(), implementation: z.unknown() })
        .parse(exports[facts.module.exportName]);
    if (exported.version !== facts.version) {
        throw new TypeError('Implementation version changed; prepare and collect a new run.');
    }
    return parseImplementation(exported.implementation);
}
