import type { HostReading } from '../bench/benchmark-host-snapshot.ts';
import { percentScale } from '../config/benchmark-host.ts';

export function unavailableHostReading<Value>(
    source: string,
    scope: HostReading<Value>['scope'],
    unit: string,
    reason: string
): HostReading<Value> {
    return { source, scope, unit, availability: 'unavailable', reason };
}

export function observeHost<Value>(
    source: string,
    scope: HostReading<Value>['scope'],
    unit: string,
    read: () => Value
): HostReading<Value> {
    try {
        return { source, scope, unit, availability: 'available', value: read() };
    } catch (error: unknown) {
        return unavailableHostReading(source, scope, unit, error instanceof Error ? error.message : String(error));
    }
}

export function hostNumber(
    source: string,
    scope: 'host' | 'process',
    unit: string,
    read: () => number
): HostReading<number> {
    return observeHost(source, scope, unit, function readFiniteValue() {
        const value = read();
        if (!Number.isFinite(value) || value < 0) {
            throw new TypeError('Host reading must be finite and nonnegative.');
        }
        return value;
    });
}

export function hostPercentage(
    source: string,
    scope: 'host' | 'process',
    numerator: HostReading<number>,
    denominator: HostReading<number>
): HostReading<number> {
    if (numerator.availability === 'unavailable') {
        return unavailableHostReading(source, scope, 'percent', numerator.reason);
    }
    if (denominator.availability === 'unavailable') {
        return unavailableHostReading(source, scope, 'percent', denominator.reason);
    }
    return hostNumber(source, scope, 'percent', function divideCapacity() {
        if (denominator.value <= 0) {
            throw new TypeError('Host capacity denominator must be positive.');
        }
        return numerator.value / denominator.value * percentScale;
    });
}

export function observerMetric(reading: HostReading<number>, scope: HostReading<number>['scope']): HostReading<number> {
    if (reading.availability === 'unavailable' || Number.isFinite(reading.value)) {
        return { ...reading, scope };
    }
    return unavailableHostReading(reading.source, scope, reading.unit, 'Native observation is not finite.');
}
