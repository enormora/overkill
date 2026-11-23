import { match } from 'ts-pattern';
import type { TSESLint, TSESTree as Tree } from '@typescript-eslint/utils';
import { type BindingOrigin, sameOrigin } from './binding-origin.ts';

export type Variable = TSESLint.Scope.Variable;
export type Allocation = Tree.ArrayExpression | Tree.ObjectExpression;
type StaticKey = { readonly kind: 'key'; readonly key: string; };
type LocalObject = { readonly kind: 'object'; readonly allocation: Allocation; };
type OriginValue = { readonly kind: 'origin'; readonly origin: BindingOrigin; };
type PossibleObjects = { readonly kind: 'possible-objects'; readonly allocations: ReadonlySet<Allocation>; };
type Value = LocalObject | OriginValue | PossibleObjects | StaticKey;

export type BindingValues<Key> = ReadonlyMap<Key, Value> & {
    readonly store: (key: Key, value: Value | undefined) => void;
};

export function bindingValues<Key>(entries: ReadonlyMap<Key, Value>): BindingValues<Key> {
    const values = new Map(entries);
    return Object.assign(values, {
        store(key: Key, value: Value | undefined) {
            if (value === undefined) {
                values.delete(key);
            } else {
                values.set(key, value);
            }
        }
    });
}

export type State = {
    readonly bindings: BindingValues<Variable>;
    readonly expressions: BindingValues<Readonly<Tree.Node>>;
    readonly objects: ReadonlyMap<Allocation, BindingValues<string>>;
    readonly setObject: (allocation: Allocation, properties: BindingValues<string>) => void;
    readonly deleteObject: (allocation: Allocation) => void;
};

export function emptyState(): State {
    const objects = new Map<Allocation, BindingValues<string>>();
    return {
        bindings: bindingValues(new Map()),
        expressions: bindingValues(new Map()),
        objects,
        setObject(allocation, properties) {
            objects.set(allocation, properties);
        },
        deleteObject(allocation) {
            objects.delete(allocation);
        }
    };
}

export function originValue(root: BindingOrigin['root'], path: readonly string[]): Value {
    return { kind: 'origin', origin: { root, path } };
}

export function sameValue(left: Value, right: Value): boolean {
    return match(left)
        .with({ kind: 'origin' }, function (matched) {
            return right.kind === 'origin' && sameOrigin(matched.origin, right.origin);
        })
        .with({ kind: 'object' }, function (matched) {
            return right.kind === 'object' && matched.allocation === right.allocation;
        })
        .with({ kind: 'possible-objects' }, function (matched) {
            return right.kind === 'possible-objects' && matched.allocations.size === right.allocations.size &&
                Array.from(matched.allocations).every(function (allocation) {
                    return right.allocations.has(allocation);
                });
        })
        .with({ kind: 'key' }, function (matched) {
            return right.kind === 'key' && matched.key === right.key;
        })
        .exhaustive();
}

export function allocationsOf(value: Value | undefined): Iterable<Allocation> {
    return match(value)
        .with({ kind: 'object' }, function (matched) {
            return [ matched.allocation ];
        })
        .with({ kind: 'possible-objects' }, function (matched) {
            return matched.allocations;
        })
        .otherwise(function () {
            return [];
        });
}

function possibleObjects(values: Iterable<Value | undefined>): Value | undefined {
    const allocations = new Set<Allocation>();
    for (const value of values) {
        for (const allocation of allocationsOf(value)) {
            allocations.add(allocation);
        }
    }
    return allocations.size === 0 ? undefined : { kind: 'possible-objects', allocations };
}

function mergeValues<Key>(left: ReadonlyMap<Key, Value>, right: ReadonlyMap<Key, Value>): BindingValues<Key> {
    const merged = bindingValues<Key>(new Map());
    const keys = new Set([ ...left.keys(), ...right.keys() ]);
    for (const key of keys) {
        const first = left.get(key);
        const second = right.get(key);
        const value = first !== undefined && second !== undefined && sameValue(first, second)
            ? first
            : possibleObjects([ first, second ]);
        merged.store(key, value);
    }
    return merged;
}

export function joinStates(left: State, right: State): State {
    const result = emptyState();
    for (const [ allocation, properties ] of left.objects) {
        const other = right.objects.get(allocation);
        if (other !== undefined) {
            result.setObject(allocation, mergeValues(properties, other));
        }
    }
    mergeValues(left.bindings, right.bindings).forEach(function (value, variable) {
        result.bindings.store(variable, value);
    });
    mergeValues(left.expressions, right.expressions).forEach(function (value, node) {
        result.expressions.store(node, value);
    });
    return result;
}

export function copyState(state: State): State {
    const result = emptyState();
    for (const [ variable, value ] of state.bindings) {
        result.bindings.store(variable, value);
    }
    for (const [ node, value ] of state.expressions) {
        result.expressions.store(node, value);
    }
    for (const [ allocation, properties ] of state.objects) {
        result.setObject(allocation, bindingValues(properties));
    }
    return result;
}

function sameValues<Key>(left: ReadonlyMap<Key, Value>, right: ReadonlyMap<Key, Value>): boolean {
    return left.size === right.size && Array.from(left).every(function ([ key, value ]) {
        const other = right.get(key);
        return other !== undefined && sameValue(value, other);
    });
}

export function sameState(left: State, right: State): boolean {
    return sameValues(left.bindings, right.bindings) && sameValues(left.expressions, right.expressions) &&
        left.objects.size === right.objects.size &&
        Array.from(left.objects).every(function ([ allocation, properties ]) {
            const other = right.objects.get(allocation);
            return other !== undefined && sameValues(properties, other);
        });
}

function possibleProperty(state: State, value: Value | undefined, key: string | undefined): Value | undefined {
    const properties = Array.from(allocationsOf(value)).flatMap(function (allocation) {
        const fields = state.objects.get(allocation);
        return key === undefined ? Array.from(fields?.values() ?? []) : [ fields?.get(key) ];
    });
    return possibleObjects(properties);
}

export function propertyOf(state: State, value: Value | undefined, key: string | undefined): Value | undefined {
    if (key === undefined) {
        return possibleProperty(state, value, key);
    }
    return match(value)
        .with({ kind: 'origin' }, function ({ origin }) {
            return originValue(origin.root, [ ...origin.path, key ]);
        })
        .with({ kind: 'object' }, function ({ allocation }) {
            return state.objects.get(allocation)?.get(key);
        })
        .otherwise(function () {
            return possibleProperty(state, value, key);
        });
}

export function forgetObject(state: State, value: Value | undefined): void {
    for (const allocation of allocationsOf(value)) {
        const properties = state.objects.get(allocation);
        state.deleteObject(allocation);
        const fields = properties?.values() ?? [];
        for (const property of fields) {
            forgetObject(state, property);
        }
    }
}

export type { Value };
