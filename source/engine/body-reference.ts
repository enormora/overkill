import { isDeepStrictEqual } from 'node:util';
import type { Except } from 'type-fest';
import { z } from 'zod/v4';
import {
    defineImplementationReference,
    readImplementationExport,
    type ImplementationReference,
    type ImplementationInputContext,
    type ImplementationFacts
} from '../implementation-reference.ts';
import { snapshotPortableValue, type PortableValue } from '../portable-value.ts';
import type { TestBody, TestScope } from './test-scope.ts';

const bodyReferenceBrand = Symbol.for('@overkill-dev/engine/BodyReference');
export type BodyReference<Scope = TestScope, Result = ReturnType<TestBody>> = {
    readonly kind: 'body-reference';
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (
        namespace: unknown,
        facts: ImplementationFacts,
        context: ImplementationInputContext
    ) => (scope: Scope) => Result;
    readonly [bodyReferenceBrand]: true;
};

export function defineBodyReference<Input extends PortableValue>(
    definition: Except<ImplementationReference<Input>, 'kind'>
): BodyReference;
export function defineBodyReference<Input extends PortableValue, Scope, Result>(
    definition: Except<ImplementationReference<Input>, 'kind'>
): BodyReference<Scope, Result>;
export function defineBodyReference<Input extends PortableValue, Scope = TestScope, Result = ReturnType<TestBody>>(
    definition: Except<ImplementationReference<Input>, 'kind'>
): BodyReference<Scope, Result> {
    const reference = defineImplementationReference(definition);
    return Object.freeze<BodyReference<Scope, Result>>({
        [bodyReferenceBrand]: true,
        kind: 'body-reference',
        reference,
        bind(namespace, facts, context) {
            const parse = z.custom<(scope: Scope, input: Input) => Result>(function callable(value) {
                return typeof value === 'function';
            });
            const body = readImplementationExport(namespace, facts, parse.parse);
            const input = snapshotPortableValue(reference.parseInput(reference.input, context));
            if (!isDeepStrictEqual(input, facts.input)) {
                throw new TypeError('Implementation inputs changed; prepare and collect a new run.');
            }
            return function executeReferencedBody(scope) {
                return body(scope, input);
            };
        }
    });
}

export function isBodyReferenceDescriptor(value: unknown): value is BodyReference<never, unknown> {
    return typeof value === 'object' && value !== null && Reflect.get(value, bodyReferenceBrand) === true;
}
