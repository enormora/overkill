import type { JsonValue, ReadonlyDeep } from 'type-fest';

export type ComparableCalibration = {
    readonly context: ReadonlyDeep<JsonValue>;
    readonly kind: 'comparable';
    readonly machineClass: string;
    readonly metadata: ReadonlyDeep<JsonValue>;
};
type NonComparableCalibration = {
    readonly kind: 'non-comparable';
    readonly metadata: ReadonlyDeep<JsonValue>;
    readonly reason: string;
};
export type BenchmarkCalibrationResult = ComparableCalibration | NonComparableCalibration;
