export type RuntimeCapabilityPolicyEnvironment = Readonly<Record<string, string | undefined>>;

type EnvironmentSnapshot = {
    readonly entries: readonly (readonly [string, string])[];
    readonly object: RuntimeCapabilityPolicyEnvironment;
};

type StorageSnapshot = {
    readonly entries: readonly (readonly [string, string])[];
    readonly object: WebStorageLike | null;
};

export type WebStorageLike = {
    readonly length: number;
    readonly getItem: (key: string) => string | null;
    readonly key: (index: number) => string | null;
};

export type RuntimeCapabilityPolicyDependencies = {
    readonly installIpcRestriction: (record: (message: string) => void) => () => void;
    readonly installProcessExecutionRestriction: (record: (message: string) => void) => () => void;
    readonly readEnvironment: () => RuntimeCapabilityPolicyEnvironment;
    readonly readStorage: (name: 'localStorage' | 'sessionStorage') => WebStorageLike | null;
};

export type RuntimeSnapshots = {
    readonly environment: EnvironmentSnapshot;
    readonly localStorage: StorageSnapshot;
    readonly sessionStorage: StorageSnapshot;
};

function sortedEnvironmentEntries(environment: RuntimeCapabilityPolicyEnvironment): readonly [string, string][] {
    return Object
        .entries(environment)
        .filter(function hasValue(entry): entry is [string, string] {
            return entry[1] !== undefined;
        })
        .toSorted(function compareEnvironmentEntries(first, second) {
            return first[0].localeCompare(second[0]);
        });
}

function environmentSnapshot(dependencies: RuntimeCapabilityPolicyDependencies): EnvironmentSnapshot {
    const environment = dependencies.readEnvironment();

    return {
        entries: sortedEnvironmentEntries(environment),
        object: environment
    };
}

export function isRuntimeCapabilityPolicyEnvironment(
    value: unknown
): value is RuntimeCapabilityPolicyEnvironment {
    return typeof value === 'object' &&
        value !== null &&
        Object.values(value).every(function validEnvironmentValue(entry) {
            return typeof entry === 'string' || entry === undefined;
        });
}

export function isWebStorageLike(value: unknown): value is WebStorageLike {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const length: unknown = Reflect.get(value, 'length');
    const getItem: unknown = Reflect.get(value, 'getItem');
    const key: unknown = Reflect.get(value, 'key');

    return typeof length === 'number' &&
        typeof getItem === 'function' &&
        typeof key === 'function';
}

function storageSnapshot(
    dependencies: RuntimeCapabilityPolicyDependencies,
    name: 'localStorage' | 'sessionStorage'
): StorageSnapshot {
    const storage = dependencies.readStorage(name);

    if (!isWebStorageLike(storage)) {
        return {
            entries: [],
            object: null
        };
    }

    const entries: readonly [string, string][] = Array
        .from({ length: storage.length }, function toStorageEntry(
            _unusedValue,
            index
        ): [string, string] | null {
            const key = storage.key(index);

            return key === null ? null : [ key, storage.getItem(key) ?? '' ];
        })
        .filter(function isEntry(entry): entry is [string, string] {
            return entry !== null;
        })
        .toSorted(function compareStorageEntries(first, second) {
            return first[0].localeCompare(second[0]);
        });

    return {
        entries,
        object: storage
    };
}

function entriesChanged(
    before: readonly (readonly [string, string])[],
    after: readonly (readonly [string, string])[]
): boolean {
    if (before.length !== after.length) {
        return true;
    }

    return before.some(function changed(entry, index) {
        const afterEntry = after[index];

        return afterEntry?.[0] !== entry[0] || afterEntry[1] !== entry[1];
    });
}

export function environmentChanged(before: RuntimeSnapshots, after: RuntimeSnapshots): boolean {
    return before.environment.object !== after.environment.object ||
        entriesChanged(before.environment.entries, after.environment.entries);
}

export function localStorageChanged(before: RuntimeSnapshots, after: RuntimeSnapshots): boolean {
    return before.localStorage.object !== after.localStorage.object ||
        entriesChanged(before.localStorage.entries, after.localStorage.entries);
}

export function sessionStorageChanged(before: RuntimeSnapshots, after: RuntimeSnapshots): boolean {
    return before.sessionStorage.object !== after.sessionStorage.object ||
        entriesChanged(before.sessionStorage.entries, after.sessionStorage.entries);
}

export function takeSnapshots(dependencies: RuntimeCapabilityPolicyDependencies): RuntimeSnapshots {
    return {
        environment: environmentSnapshot(dependencies),
        localStorage: storageSnapshot(dependencies, 'localStorage'),
        sessionStorage: storageSnapshot(dependencies, 'sessionStorage')
    };
}
