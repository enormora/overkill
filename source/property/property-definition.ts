import type {
    AssertionResult,
    DefinitionLocations,
    TestScope,
    PropertySettings,
    PropertyBodyDefinition
} from '../packages/engine/engine.entry-point.ts';
import type { Generator as PropertyGenerator } from './generator.ts';

export type PropertyCoverageRequirement = { readonly label: string; readonly minimumPercent: number; };
type CoverageDeclaration = { readonly coverage: readonly PropertyCoverageRequirement[]; };
type ExamplesDeclaration<Value> = { readonly examples: readonly PropertyExample<Value>[]; };

export type PropertySampleScope = TestScope & {
    readonly target: (label: string, score: number) => void;
    readonly cover: (label: string, condition: boolean) => void;
};

export type PropertyBody<Value> = (
    value: Value,
    sample: PropertySampleScope
) => AssertionResult | Promise<AssertionResult>;

export type PropertyExample<Value> = () => Value;

type PropertyInvocationBody<Value> = {
    readonly generator: PropertyGenerator<Value>;
    readonly test: PropertyBody<Value>;
};

type ExampleInvocation<Value> = ExamplesDeclaration<Value> & PropertyInvocationBody<Value>;
type CoveredInvocation<Value> = CoverageDeclaration & PropertyInvocationBody<Value>;
export type NormalizedPropertyInvocation<Value> = CoverageDeclaration & ExampleInvocation<Value>;
type UncoveredInvocation<Value> = ExampleInvocation<Value> | PropertyInvocationBody<Value>;
type RequiredCoverageInvocation<Value> = CoveredInvocation<Value> | NormalizedPropertyInvocation<Value>;
export type PropertyInvocation<Value> = RequiredCoverageInvocation<Value> | UncoveredInvocation<Value>;

type PropertyDefinitionBody<Value> = PropertyInvocation<Value> & { readonly title: string; };

export type PropertyForall = {
    <Value>(generator: PropertyGenerator<Value>, body: PropertyBody<Value>): Promise<AssertionResult>;
    <Value>(invocation: PropertyInvocation<Value>): Promise<AssertionResult>;
};

type ConfiguredPropertyDefinition<Value> = PropertyDefinitionBody<Value> & { readonly settings: PropertySettings; };
export type PropertyDefinition<Value> = ConfiguredPropertyDefinition<Value> | PropertyDefinitionBody<Value>;

export type PropertyCaseScope = TestScope & {
    readonly forall: PropertyForall;
};

export type PropertyCaseBody = (scope: PropertyCaseScope) => AssertionResult | Promise<AssertionResult>;

export type PropertyDeclaration<Value> = PropertyBodyDefinition & {
    readonly examples: readonly PropertyExample<Value>[];
    readonly kind: 'property';
    readonly generator: PropertyGenerator<Value>;
    readonly test: PropertyBody<Value>;
    readonly definitionLocations: DefinitionLocations;
};

export type NestedPropertyDeclaration = PropertyBodyDefinition & {
    readonly kind: 'nested';
    readonly body: PropertyCaseBody;
    readonly definitionLocations: DefinitionLocations;
};
