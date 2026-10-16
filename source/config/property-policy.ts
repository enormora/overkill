import { z } from 'zod/v4';
import { isPropertyBodyDefinition, type PropertyBodyDefinition, type PropertyPolicy } from '../engine/property-node.ts';

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const propertyPolicySchema = z
    .strictObject({
        version: z.literal(1),
        newTrials: positiveInteger,
        maxSize: nonnegativeInteger,
        maxDepth: nonnegativeInteger,
        maxAutomaticEdges: nonnegativeInteger,
        maxExhaustiveValues: nonnegativeInteger,
        maxWork: positiveInteger,
        maxShrinkWork: nonnegativeInteger,
        maxLabels: positiveInteger,
        maxRetainedInputs: positiveInteger
    })
    .readonly();

export const propertySettingsSchema = propertyPolicySchema.unwrap().omit({ version: true }).partial().readonly();

export const propertySettingsDeclarationSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('profile-default') }),
    z.strictObject({ kind: z.literal('settings'), settings: propertySettingsSchema })
]);

export const defaultPropertyPolicy: PropertyPolicy = Object.freeze({
    version: 1,
    newTrials: 100,
    maxSize: 100,
    maxDepth: 10,
    maxAutomaticEdges: 100,
    maxExhaustiveValues: 1000,
    maxWork: 10_000,
    maxShrinkWork: 1000,
    maxLabels: 100,
    maxRetainedInputs: 100
});

export function resolvePropertySettings(defaults: PropertyPolicy, value: unknown): PropertyPolicy {
    const settings = propertySettingsSchema.parse(value);
    const supplied = Object.fromEntries(
        Object.entries(settings).filter(function hasSetting([ , setting ]) {
            return setting !== undefined;
        })
    );
    return propertyPolicySchema.parse({ ...defaults, ...supplied });
}

export function resolvePropertyPolicy(defaults: PropertyPolicy, definition: PropertyBodyDefinition): PropertyPolicy {
    if (!isPropertyBodyDefinition(definition)) {
        throw new TypeError('Property requires a valid collected declaration.');
    }
    if (definition.settingsDeclarations.length !== 1) {
        throw new TypeError('withProperties() cannot reconfigure an existing property declaration.');
    }
    const declaration = propertySettingsDeclarationSchema.parse(definition.settingsDeclarations[0]);
    const settings = declaration.kind === 'settings' ? declaration.settings : {};
    return resolvePropertySettings(defaults, settings);
}
