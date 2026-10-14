import type {
    AssertionResult,
    DefinitionLocations,
    TestScope,
    PropertySettings,
    PropertyBodyDefinition
} from '../packages/engine/engine.entry-point.ts';
import type { Generator as PropertyGenerator } from './generator.ts';

export type PropertySampleScope = TestScope & {
    readonly target: (label: string, score: number) => void;
    readonly cover: (label: string, condition: boolean) => void;
};

export type PropertyBody<Value> = (
    value: Value,
    sample: PropertySampleScope
) => AssertionResult | Promise<AssertionResult>;

type PropertyDefinitionBody<Value> = {
    readonly title: string;
    readonly generator: PropertyGenerator<Value>;
    readonly test: PropertyBody<Value>;
};

type ConfiguredPropertyDefinition<Value> = PropertyDefinitionBody<Value> & { readonly settings: PropertySettings; };
export type PropertyDefinition<Value> = ConfiguredPropertyDefinition<Value> | PropertyDefinitionBody<Value>;

export type PropertyCaseScope = TestScope & {
    readonly forall: <Value>(
        generator: PropertyGenerator<Value>,
        body: PropertyBody<Value>
    ) => Promise<AssertionResult>;
};

export type PropertyCaseBody = (scope: PropertyCaseScope) => AssertionResult | Promise<AssertionResult>;

export type PropertyDeclaration<Value> = PropertyBodyDefinition & {
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
