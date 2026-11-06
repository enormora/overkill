import type { AssertionResult } from '../packages/engine/engine.entry-point.ts';
import type { PropertyBody, PropertySampleScope } from './property-definition.ts';

export type RelationObservation<Input, Output> = {
    readonly input: Input;
    readonly output: Output;
};

export type RelationObservations<Input, Output> = {
    readonly original: RelationObservation<Input, Output>;
    readonly transformed: RelationObservation<Input, Output>;
};

export type RelationDefinition<Input, Output> = {
    readonly transform: (input: Input) => Input | Promise<Input>;
    readonly run: (input: Input, sample: PropertySampleScope) => Output | Promise<Output>;
    readonly check: (
        observations: RelationObservations<Input, Output>,
        sample: PropertySampleScope
    ) => AssertionResult | Promise<AssertionResult>;
};

function ensureRelationDefinition(definition: unknown): void {
    if (
        typeof definition !== 'object' || definition === null ||
        typeof Reflect.get(definition, 'transform') !== 'function' ||
        typeof Reflect.get(definition, 'run') !== 'function' ||
        typeof Reflect.get(definition, 'check') !== 'function'
    ) {
        throw new TypeError('relation() requires transform, run, and check callbacks.');
    }
}

export function relation<Input, Output>(definition: RelationDefinition<Input, Output>): PropertyBody<Input> {
    ensureRelationDefinition(definition);
    const { transform, run, check } = definition;
    return async function checkRelation(input, sample) {
        sample.signal.throwIfAborted();
        const transformedInput = await transform(input);
        sample.signal.throwIfAborted();
        const originalOutput = await run(input, sample);
        sample.signal.throwIfAborted();
        const transformedOutput = await run(transformedInput, sample);
        sample.signal.throwIfAborted();
        return await check({
            original: { input, output: originalOutput },
            transformed: { input: transformedInput, output: transformedOutput }
        }, sample);
    };
}
