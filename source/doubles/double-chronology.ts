import type { InvocationKind } from './double-behavior.ts';

export type ChronologyOrder = {
    readonly kind: InvocationKind;
    readonly order: number;
};

export type ChronologyScope = {
    readonly nextOrder: () => number;
    readonly token: Readonly<Record<string, unknown>>;
};

const testDoubleSymbol = Symbol('overkill.testDouble');
const chronologySymbol = Symbol('overkill.doubleChronology');

export type DoubleChronology = {
    readonly calls: readonly ChronologyOrder[];
    readonly constructions: readonly ChronologyOrder[];
    readonly interactions: readonly ChronologyOrder[];
    readonly record: (event: ChronologyOrder) => void;
    readonly reset: () => void;
    readonly scope: ChronologyScope;
};

export function createChronologyScope(): ChronologyScope {
    let nextOrder = 0;
    const token = {};

    return {
        nextOrder() {
            const order = nextOrder;
            nextOrder += 1;

            return order;
        },
        token
    };
}

function createDoubleChronology(scope: ChronologyScope): DoubleChronology {
    const calls: ChronologyOrder[] = [];
    const constructions: ChronologyOrder[] = [];
    const interactions: ChronologyOrder[] = [];

    return {
        calls,
        constructions,
        interactions,
        record(event) {
            if (event.kind === 'call') {
                calls.push(event);
            } else {
                constructions.push(event);
            }

            interactions.push(event);
        },
        reset() {
            calls.length = 0;
            constructions.length = 0;
            interactions.length = 0;
        },
        scope
    };
}

function isChronologyRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function hasChronologyArrays(value: Readonly<Record<PropertyKey, unknown>>): boolean {
    return Array.isArray(Reflect.get(value, 'calls')) &&
        Array.isArray(Reflect.get(value, 'constructions')) &&
        Array.isArray(Reflect.get(value, 'interactions'));
}

function hasChronologyFunctions(value: Readonly<Record<PropertyKey, unknown>>): boolean {
    return typeof Reflect.get(value, 'record') === 'function' &&
        typeof Reflect.get(value, 'reset') === 'function';
}

function isDoubleChronology(value: unknown): value is DoubleChronology {
    return isChronologyRecord(value) &&
        hasChronologyArrays(value) &&
        hasChronologyFunctions(value);
}

export function doubleChronology(value: unknown): DoubleChronology | null {
    if (typeof value !== 'function' || !Object.hasOwn(value, testDoubleSymbol)) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, chronologySymbol);

    return isDoubleChronology(descriptor?.value) ? descriptor.value : null;
}

export function installDoubleChronology(
    target: (...arguments_: readonly unknown[]) => unknown,
    scope: ChronologyScope
): DoubleChronology {
    const chronology = createDoubleChronology(scope);

    Object.defineProperties(target, {
        [chronologySymbol]: {
            enumerable: false,
            value: chronology
        },
        [testDoubleSymbol]: {
            enumerable: false,
            value: true
        }
    });

    return chronology;
}
