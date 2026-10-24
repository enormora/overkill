import * as backend from 'fast-check';
import {
    createGenerator,
    prepareGenerator,
    ensureGenerator,
    isGenerator,
    type Generator as PropertyGenerator
} from './generator.ts';
import {
    effectiveLength,
    lengthBounds,
    nonnegativeLimit,
    type LengthBounds,
    type RecursiveGeneratorDefinition
} from './generator-constraints.ts';

function requireGenerator(value: unknown): PropertyGenerator<unknown> {
    if (!isGenerator(value)) {
        throw new TypeError('Property requires an Overkill generator.');
    }
    return value;
}

export function array<Value>(
    element: PropertyGenerator<Value>,
    ...bounds: readonly [] | readonly [LengthBounds]
): PropertyGenerator<Value[]> {
    ensureGenerator(element);
    const constraints = bounds.length === 0 ? null : lengthBounds(bounds[0]);
    return createGenerator(function (context) {
        return backend.array(
            prepareGenerator(element, context),
            { ...effectiveLength(constraints, context), size: 'small' }
        );
    }, null);
}

export function tuple<Values extends unknown[]>(
    ...elements: { readonly [Key in keyof Values]: PropertyGenerator<Values[Key]>; }
): PropertyGenerator<Values>;
export function tuple(...elements: readonly unknown[]): unknown {
    const components = elements.map(requireGenerator);
    return createGenerator(function (context) {
        return backend.tuple(...components.map(function componentDomain(component) {
            context.consumeWork();
            return prepareGenerator(component, context);
        }));
    }, null);
}

export function record<Values extends Record<string, unknown> = Record<PropertyKey, never>>(
    fields: { readonly [Key in keyof Values]: PropertyGenerator<Values[Key]>; }
): PropertyGenerator<Values>;
export function record(fields: unknown): unknown {
    if (typeof fields !== 'object' || fields === null) {
        throw new TypeError('Generator records require a field object.');
    }
    const prototype: unknown = Object.getPrototypeOf(fields);
    if (prototype !== null && prototype !== Object.prototype) {
        throw new TypeError('Generator records require a plain field object.');
    }
    const components = Reflect.ownKeys(fields).map(
        function fieldDomain(key): readonly [string, PropertyGenerator<unknown>] {
            const descriptor = Object.getOwnPropertyDescriptor(fields, key);
            if (
                typeof key !== 'string' || descriptor?.enumerable !== true || !Object
                    .hasOwn(descriptor, 'value')
            ) {
                throw new TypeError('Generator record fields must be enumerable string data properties.');
            }
            const value: unknown = descriptor.value;
            return [ key, requireGenerator(value) ];
        }
    );
    return createGenerator(
        function (context) {
            return backend.record(
                Object.fromEntries(components.map(function fieldDomain([ key, component ]) {
                    context.consumeWork();
                    return [ key, prepareGenerator(component, context) ];
                })),
                { noNullPrototype: true }
            );
        },
        null
    );
}

export function choice<Values extends [unknown, ...unknown[]]>(
    ...alternatives: { readonly [Key in keyof Values]: PropertyGenerator<Values[Key]>; }
): PropertyGenerator<Values[number]>;
export function choice(...alternatives: readonly unknown[]): unknown {
    if (alternatives.length === 0) {
        throw new RangeError('Generator choices require at least one alternative.');
    }
    const components = alternatives.map(requireGenerator);
    return createGenerator(function (context) {
        return backend.oneof(
            { depthSize: 'small' },
            ...components.map(function alternativeDomain(component) {
                context.consumeWork();
                return prepareGenerator(component, context);
            })
        );
    }, null);
}

function ensureRecursiveDefinition(value: unknown): void {
    if (typeof value !== 'object' || value === null || typeof Reflect.get(value, 'branch') !== 'function') {
        throw new TypeError('Recursive generators require a leaf, branch callback, and maximum depth.');
    }
}

export function recursive<Value>(definition: RecursiveGeneratorDefinition<Value>): PropertyGenerator<Value> {
    ensureRecursiveDefinition(definition);
    const { branch } = definition;
    ensureGenerator(definition.leaf);
    const leaf = definition.leaf.map<Value>(function recursiveValue(value) {
        return value;
    });
    const maxDepth = nonnegativeLimit(definition.maxDepth);
    return createGenerator(function recursiveDomain(context): backend.Arbitrary<Value> {
        const remaining = Math.min(maxDepth, context.maxDepth);
        const leafDomain = prepareGenerator(leaf, { ...context, maxDepth: remaining });
        if (remaining === 0) {
            return leafDomain;
        }
        const child = createGenerator(function childDomain(childContext) {
            return recursiveDomain({ ...childContext, maxDepth: Math.min(remaining - 1, childContext.maxDepth) });
        }, null);
        context.consumeWork();
        const expanded = branch(child);
        ensureGenerator(expanded);
        const expandedDomain = expanded.map<Value>(function recursiveValue(value) {
            return value;
        });
        return backend.oneof(
            { withCrossShrink: true, depthSize: 'small' },
            leafDomain,
            prepareGenerator(expandedDomain, { ...context, maxDepth: remaining - 1 })
        );
    }, null);
}
