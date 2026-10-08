export type StoredValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

export function createStoredValue<Value>(initialValue: Value): StoredValue<Value> {
    let currentValue = initialValue;

    return {
        read() {
            return currentValue;
        },
        write(value) {
            currentValue = value;
        }
    };
}
