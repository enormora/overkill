import type { Except } from 'type-fest';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';

export type PropertyPolicy = {
    readonly version: 1;
    readonly newTrials: number;
    readonly maxSize: number;
    readonly maxDepth: number;
    readonly maxAutomaticEdges: number;
    readonly maxExhaustiveValues: number;
    readonly maxWork: number;
    readonly maxShrinkWork: number;
    readonly maxLabels: number;
    readonly maxRetainedInputs: number;
};

export type PropertySettings = Readonly<
    Partial<{ readonly [Key in keyof Except<PropertyPolicy, 'version'>]: PropertyPolicy[Key] | undefined; }>
>;

export type PropertySettingsDeclaration = {
    readonly kind: 'profile-default';
} | {
    readonly kind: 'settings';
    readonly settings: unknown;
};

export type PropertyBodyDefinition = {
    readonly kind: 'nested' | 'property';
    readonly settingsDeclarations: NonEmptyReadonlyArray<PropertySettingsDeclaration>;
};

export type PropertyPolicyResolution = {
    readonly kind: 'resolved';
    readonly policy: PropertyPolicy;
} | {
    readonly kind: 'unresolved';
};

export function isPropertyBodyDefinition(value: unknown): value is PropertyBodyDefinition {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const kind: unknown = Reflect.get(value, 'kind');
    const declarations: unknown = Reflect.get(value, 'settingsDeclarations');
    return (kind === 'property' || kind === 'nested') && Array.isArray(declarations) && declarations.length > 0;
}
