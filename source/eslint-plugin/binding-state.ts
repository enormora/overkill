import { match } from 'ts-pattern';
import type { TSESLint, TSESTree as Tree } from '@typescript-eslint/utils';
import { type BindingOrigin, sameOrigin } from './binding-origin.ts';

export type Variable = TSESLint.Scope.Variable;
export type Allocation = Tree.ArrayExpression | Tree.ObjectExpression;
type StaticKey = { readonly kind: 'key'; readonly key: string; };
type LocalObject = { readonly kind: 'object'; readonly allocation: Allocation; };
type OriginValue = { readonly kind: 'origin'; readonly origin: BindingOrigin; };
type PossibleObjects = { readonly kind: 'possible-objects'; readonly allocations: ReadonlySet<Allocation>; };
type Scalar = LocalObject | OriginValue | PossibleObjects | StaticKey;
type Value = Scalar | { readonly kind: 'alternatives'; readonly values: readonly Scalar[]; };

export function alternatives(value: Value | undefined): readonly Scalar[] {
    if (value === undefined) {
        return [];
    }
    return value.kind === 'alternatives' ? value.values : [ value ];
}

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
    readonly trackAlternatives: boolean;
    readonly bindings: BindingValues<Variable>;
    readonly expressions: BindingValues<Readonly<Tree.Node>>;
    readonly objects: ReadonlyMap<Allocation, BindingValues<string>>;
    readonly setObject: (allocation: Allocation, properties: BindingValues<string>) => void;
    readonly deleteObject: (allocation: Allocation) => void;
};

export function emptyState(trackAlternatives: boolean): State {
    const objects = new Map<Allocation, BindingValues<string>>();
    return {
        trackAlternatives,
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
        .with({ kind: 'alternatives' }, function (matched) {
            return right.kind === 'alternatives' && matched.values.length === right.values.length &&
                matched.values.every(function (value) {
                    return right.values.some(function (other) {
                        return sameValue(value, other);
                    });
                });
        })
        .with({ kind: 'key' }, function (matched) {
            return right.kind === 'key' && matched.key === right.key;
        })
        .exhaustive();
}

export function possibleValues(values: readonly (Value | undefined)[]): Value | undefined {
    const unique: Scalar[] = [];
    for (const value of values.flatMap(alternatives)) {
        if (
            unique.every(function (other) {
                return !sameValue(value, other);
            })
        ) {
            unique.push(value);
        }
    }
    return unique.length === 0 ? undefined : { kind: 'alternatives', values: unique };
}

export function allocationsOf(value: Value | undefined): Iterable<Allocation> {
    if (value?.kind === 'alternatives') {
        return value.values.flatMap(function (item) {
            return Array.from(allocationsOf(item));
        });
    }
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

function mergeValue(
    first: Value | undefined,
    second: Value | undefined,
    trackAlternatives: boolean
): Value | undefined {
    if (first !== undefined && second !== undefined && sameValue(first, second)) {
        return first;
    }
    return trackAlternatives ? possibleValues([ first, second ]) : possibleObjects([ first, second ]);
}

function mergeValues<Key>(
    left: ReadonlyMap<Key, Value>,
    right: ReadonlyMap<Key, Value>,
    trackAlternatives: boolean
): BindingValues<Key> {
    const merged = bindingValues<Key>(new Map());
    const keys = new Set([ ...left.keys(), ...right.keys() ]);
    for (const key of keys) {
        const first = left.get(key);
        const second = right.get(key);
        merged.store(key, mergeValue(first, second, trackAlternatives));
    }
    return merged;
}

function mergeFields(
    first: ReadonlyMap<string, Value> | undefined,
    second: ReadonlyMap<string, Value> | undefined,
    trackAlternatives: boolean
): BindingValues<string> | null {
    if (!trackAlternatives && (first === undefined || second === undefined)) {
        return null;
    }
    return mergeValues(first ?? new Map(), second ?? new Map(), trackAlternatives);
}

function mergeAllocations(left: State, right: State, result: State): void {
    const { trackAlternatives } = left;
    const allocations = new Set([ ...left.objects.keys(), ...right.objects.keys() ]);
    for (const allocation of allocations) {
        const fields = mergeFields(left.objects.get(allocation), right.objects.get(allocation), trackAlternatives);
        if (fields !== null) {
            result.setObject(allocation, fields);
        }
    }
}

export function joinStates(left: State, right: State): State {
    const { trackAlternatives } = left;
    const result = emptyState(trackAlternatives);
    mergeAllocations(left, right, result);
    mergeValues(left.bindings, right.bindings, trackAlternatives).forEach(function (value, variable) {
        result.bindings.store(variable, value);
    });
    mergeValues(left.expressions, right.expressions, trackAlternatives).forEach(function (value, node) {
        result.expressions.store(node, value);
    });
    return result;
}

export function copyState(state: State): State {
    const result = emptyState(state.trackAlternatives);
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

const maximumAlternativePathLength = 3;

export function propertyOf(state: State, value: Value | undefined, key: string | undefined): Value | undefined {
    if (key === undefined) {
        return possibleProperty(state, value, key);
    }
    if (value?.kind === 'alternatives') {
        return possibleValues(value.values.map(function (item) {
            return propertyOf(state, item, key);
        }));
    }
    return match(value)
        .with({ kind: 'origin' }, function ({ origin }) {
            if (state.trackAlternatives && origin.path.length >= maximumAlternativePathLength) {
                return undefined;
            }
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
