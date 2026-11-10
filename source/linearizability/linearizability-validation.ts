import { z } from 'zod';

const returned = z
    .object({ kind: z.literal('returned'), value: z.unknown() })
    .refine(function hasValue(value) {
        return Object.hasOwn(value, 'value');
    });
const threw = z
    .object({ kind: z.literal('threw'), error: z.unknown() })
    .refine(function hasError(value) {
        return Object.hasOwn(value, 'error');
    });
const invocation = z
    .object({ kind: z.literal('invoke'), id: z.string().trim().min(1), operation: z.unknown() })
    .refine(function hasOperation(value) {
        return Object.hasOwn(value, 'operation');
    });
const response = z.object({
    kind: z.literal('respond'),
    id: z.string().trim().min(1),
    outcome: z.union([ returned, threw ])
});
const callable = z.custom(function isCallable(value) {
    return typeof value === 'function';
});
const requestSchema = z.object({
    history: z.array(z.union([ invocation, response ])),
    model: z.object({ initial: callable, transition: callable }),
    maxWork: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    signal: z.instanceof(AbortSignal)
});
const minimumAlternatives = 2;
const alternativeStates = z
    .custom(function dense(value) {
        return Array.isArray(value) && Array.from(value.keys()).every(function present(index) {
            return Object.hasOwn(value, index);
        });
    })
    .pipe(z.array(z.unknown()).min(minimumAlternatives));
const transitionSchema = z.union([
    z.object({ kind: z.literal('disabled') }),
    z
        .object({ kind: z.literal('enabled'), state: z.unknown() })
        .refine(function hasState(value) {
            return Object.hasOwn(value, 'state');
        }),
    z.object({ kind: z.literal('alternatives'), states: alternativeStates })
]);

export function validateLinearizabilityRequest(request: unknown): void {
    if (!requestSchema.safeParse(request).success) {
        throw new TypeError('Invalid linearizability request.');
    }
}

export function validateLinearizabilityTransition(transition: unknown): void {
    if (!transitionSchema.safeParse(transition).success) {
        throw new TypeError('Invalid linearizability model transition.');
    }
}
