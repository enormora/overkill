import { z } from 'zod';
import { isTestControlError } from '../packages/engine/engine.entry-point.ts';
import type { PropertyBody, PropertySampleScope } from '../packages/property/property.entry-point.ts';
import type {
    DifferentialDefinition,
    DifferentialImplementation,
    DifferentialObservation,
    DifferentialOutcome
} from './differential-definition.ts';

const implementationSchema = z.object({
    name: z.string().refine(function nonblank(name) {
        return name.trim().length > 0;
    }),
    run: z.function()
});
const definitionSchema = z.object({
    check: z.function(),
    implementations: z
        .tuple([ implementationSchema, implementationSchema ], implementationSchema)
        .refine(function uniqueNames(implementations) {
            const names = new Set(implementations.map(function name(implementation) {
                return implementation.name;
            }));
            return names.size === implementations.length;
        })
});

function validateDefinition(definition: unknown): void {
    if (!definitionSchema.safeParse(definition).success) {
        throw new TypeError(
            'differential() requires at least two uniquely named implementations and a check callback.'
        );
    }
}

async function captureOutcome<Input, Output>(
    implementation: DifferentialImplementation<Input, Output>,
    input: Input,
    signal: AbortSignal
): Promise<DifferentialOutcome<Output>> {
    try {
        return { kind: 'returned', value: await implementation.run(input, signal) };
    } catch (error: unknown) {
        signal.throwIfAborted();
        if (isTestControlError(error)) {
            throw error;
        }
        return { kind: 'threw', error };
    }
}

async function observeImplementation<Input, Output>(
    implementation: DifferentialImplementation<Input, Output>,
    sample: PropertySampleScope<Input>
): Promise<DifferentialObservation<Input, Output>> {
    sample.signal.throwIfAborted();
    const input = sample.reconstructInput();
    sample.signal.throwIfAborted();
    const outcome = await captureOutcome(implementation, input, sample.signal);
    sample.signal.throwIfAborted();
    return Object.freeze({ name: implementation.name, input, outcome: Object.freeze(outcome) });
}

export function differential<Input, Output>(definition: DifferentialDefinition<Input, Output>): PropertyBody<Input> {
    validateDefinition(definition);
    const [ first, second, ...remaining ] = definition.implementations.map(function snapshotImplementation(value) {
        return Object.freeze({ name: value.name, run: value.run });
    });
    if (first === undefined || second === undefined) {
        throw new TypeError('differential() requires at least two implementations.');
    }
    const { check } = definition;
    return async function compareImplementations(_input, sample) {
        const firstObservation = await observeImplementation(first, sample);
        const secondObservation = await observeImplementation(second, sample);
        const rest: DifferentialObservation<Input, Output>[] = [];
        for (const implementation of remaining) {
            rest.push(await observeImplementation(implementation, sample));
        }
        sample.signal.throwIfAborted();
        const result = await check(Object.freeze([ firstObservation, secondObservation, ...rest ]), sample);
        sample.signal.throwIfAborted();
        return result;
    };
}
