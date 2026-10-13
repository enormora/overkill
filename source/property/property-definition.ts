import type { AssertionResult, DefinitionLocations, TestScope } from '../packages/engine/engine.entry-point.ts';
import type { Generator as PropertyGenerator } from './generator.ts';

export type PropertySampleScope = TestScope & {
    readonly target: (label: string, score: number) => void;
    readonly cover: (label: string, condition: boolean) => void;
};

export type PropertyBody<Value> = (
    value: Value,
    sample: PropertySampleScope
) => AssertionResult | Promise<AssertionResult>;

export type PropertyDefinition<Value> = {
    readonly title: string;
    readonly generator: PropertyGenerator<Value>;
    readonly test: PropertyBody<Value>;
};

export type PropertyCaseScope = TestScope & {
    readonly forall: <Value>(
        generator: PropertyGenerator<Value>,
        body: PropertyBody<Value>
    ) => Promise<AssertionResult>;
};

export type PropertyCaseBody = (scope: PropertyCaseScope) => AssertionResult | Promise<AssertionResult>;

export type PropertyDeclaration<Value> = {
    readonly kind: 'property';
    readonly generator: PropertyGenerator<Value>;
    readonly test: PropertyBody<Value>;
    readonly definitionLocations: DefinitionLocations;
};

export type NestedPropertyDeclaration = {
    readonly kind: 'nested';
    readonly body: PropertyCaseBody;
    readonly definitionLocations: DefinitionLocations;
};
