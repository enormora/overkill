export type WorkUnitQueue<T> = {
    readonly all: () => readonly T[];
    readonly clear: () => void;
    readonly push: (unit: T) => void;
    readonly pushMany: (units: readonly T[]) => void;
    readonly remove: (unit: T) => void;
    readonly takeFirst: () => T | null;
};

export type LeaseCounter = {
    readonly active: () => number;
    readonly decrement: () => void;
    readonly increment: () => void;
};

export type ChangeWaiters = {
    readonly notify: () => void;
    readonly wait: () => Promise<void>;
};

export function createWorkUnitQueue<T>(initialUnits: readonly T[]): WorkUnitQueue<T> {
    let units = Array.from(initialUnits);

    return {
        all() {
            return units;
        },
        clear() {
            units = [];
        },
        push(unit) {
            units = [ ...units, unit ];
        },
        pushMany(nextUnits) {
            units = [ ...units, ...nextUnits ];
        },
        remove(unit) {
            units = units.filter(function keep(candidate) {
                return candidate !== unit;
            });
        },
        takeFirst() {
            const [ unit, ...remaining ] = units;

            units = remaining;

            return unit ?? null;
        }
    };
}

export function createLeaseCounter(): LeaseCounter {
    let count = 0;

    return {
        active() {
            return count;
        },
        decrement() {
            count -= 1;
        },
        increment() {
            count += 1;
        }
    };
}

export function createChangeWaiters(): ChangeWaiters {
    let waiters: readonly (() => void)[] = [];

    return {
        notify() {
            const currentWaiters = waiters;

            waiters = [];

            for (const resolve of currentWaiters) {
                resolve();
            }
        },
        async wait() {
            await new Promise<void>(function waitForChange(resolve) {
                waiters = [ ...waiters, resolve ];
            });
        }
    };
}
