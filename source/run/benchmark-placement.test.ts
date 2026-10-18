import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    benchmarkPlacementFactsSchema,
    type BenchmarkHostAssessment,
    type BenchmarkHostSnapshot,
    type HostReading
} from '../bench/benchmark-host-snapshot.ts';
import { quietHost, definition } from '../test-support/benchmark-placement-fixture.ts';
import { resolveBenchmarkPlacement } from './benchmark-placement.ts';

function reading(value: number): HostReading<number> {
    return { availability: 'available', value, source: 'fixture', scope: 'host', unit: 'percent' };
}

function ceiling(host: BenchmarkHostAssessment | null): number {
    return resolveBenchmarkPlacement({ definitions: [ definition() ], host, processModel: 'worker-pool' })
        .maximumWorkers;
}

function withSignals(signals: Partial<BenchmarkHostSnapshot['signals']>): BenchmarkHostAssessment {
    const host = quietHost();
    return { ...host, snapshot: { ...host.snapshot, signals: { ...host.snapshot.signals, ...signals } } };
}

export const testNode = suite('adaptive benchmark placement policy', [
    test('trusts artifact-size returns and does not treat async mode as capacity evidence', function (scope) {
        for (const mode of [ 'sync', 'async' ] as const) {
            const facts = resolveBenchmarkPlacement({
                definitions: [ { ...definition(), measurement: { mode, collectors: [] } } ],
                host: quietHost(),
                processModel: 'worker-pool'
            });
            scope.assert.equal(facts.maximumWorkers, 7);
            scope.assert.equal(benchmarkPlacementFactsSchema.safeParse(facts).success, true);
        }
        return scope.assert.collect();
    }),
    test('serializes timing metrics, every collector, other kinds, missing metadata and mixed work', function (scope) {
        const size = definition();
        const sensitive = [
            null,
            { ...size, kind: 'runtime' },
            { ...size, diagnostics: [ 'durationMicroseconds' ] },
            {
                ...size,
                budgets: {
                    small: [ {
                        ...size
                            .budgets
                            .small
                            ?.[0],
                        metric: 'operationsPerSecond',
                        maximum: 100,
                        minimum: null,
                        statistic: { kind: 'observed-maximum' as const }
                    } ]
                }
            },
            { ...size, measurement: { mode: 'sync' as const, collectors: [ { name: 'custom', metrics: [] } ] } }
        ];
        for (const candidate of sensitive) {
            const facts = resolveBenchmarkPlacement({
                definitions: [ size, candidate ],
                host: quietHost(),
                processModel: 'worker-pool'
            });
            scope.assert.equal(facts.maximumWorkers, 1);
            scope.assert.true(facts.limits.some(function measurement(limit) {
                return limit.reason === 'measurement';
            }));
        }
        return scope.assert.collect();
    }),
    test('uses CPU demand and reserves coordination capacity without summing correlated signals', function (scope) {
        scope.assert.equal(ceiling(quietHost()), 7);
        scope.assert.equal(ceiling(withSignals({ cpuBusyPercent: reading(50) })), 3);
        scope.assert.equal(ceiling(withSignals({ cpuBusyPercent: reading(100) })), 1);
        const host = withSignals({ cpuBusyPercent: reading(50) });
        const loaded = {
            ...host,
            snapshot: {
                ...host.snapshot,
                capacity: {
                    ...host
                        .snapshot
                        .capacity,
                    loadAverage: {
                        availability: 'available' as const,
                        value: [ 4, 0, 0 ] as const,
                        source: 'fixture',
                        scope: 'host' as const,
                        unit: 'load'
                    }
                }
            }
        };
        scope.assert.equal(ceiling(loaded), 3);
        scope.assert.equal(
            ceiling({
                ...loaded,
                snapshot: {
                    ...loaded.snapshot,
                    capacity: {
                        ...loaded.snapshot.capacity,
                        loadAverage: {
                            ...loaded
                                .snapshot
                                .capacity
                                .loadAverage,
                            availability: 'available',
                            value: [ 6, 0, 0 ]
                        }
                    }
                }
            }),
            1
        );
        return scope.assert.collect();
    }),
    test('falls back on missing or invalid required evidence and zero memory', function (scope) {
        scope.assert.equal(ceiling(null), 1);
        scope.assert.equal(ceiling(withSignals({ availableMemoryPercent: reading(0) })), 1);
        for (const value of [ -1, 101, Number.NaN, Number.POSITIVE_INFINITY ]) {
            scope.assert.equal(ceiling(withSignals({ cpuBusyPercent: reading(value) })), 1);
        }
        scope.assert.equal(
            ceiling(withSignals({
                cpuBusyPercent: {
                    availability: 'unavailable',
                    source: 'fixture',
                    scope: 'host',
                    unit: 'percent',
                    reason: 'unsupported'
                }
            })),
            1
        );
        return scope.assert.collect();
    }),
    test('serializes native pressure and Darwin throttling without requiring platform probes', function (scope) {
        for (const signal of [ 'linuxCpuStallPercent', 'linuxMemoryStallPercent', 'linuxIoStallPercent' ] as const) {
            scope.assert.equal(ceiling(withSignals({ [signal]: reading(0.01) })), 1);
        }
        const host = quietHost();
        for (const signal of [ 'darwinCpuSpeedPercent', 'darwinCpuSchedulerPercent' ] as const) {
            scope.assert.equal(
                ceiling({
                    ...host,
                    snapshot: {
                        ...host.snapshot,
                        runtime: {
                            ...host
                                .snapshot
                                .runtime,
                            operatingSystem: 'darwin'
                        },
                        signals: { ...host.snapshot.signals, [signal]: reading(99) }
                    }
                }),
                1
            );
        }
        const unavailable = {
            availability: 'unavailable' as const,
            source: 'fixture',
            scope: 'host' as const,
            unit: 'percent',
            reason: 'unsupported'
        };
        scope.assert.equal(
            ceiling(
                withSignals({
                    linuxCpuStallPercent: unavailable,
                    linuxMemoryStallPercent: unavailable,
                    linuxIoStallPercent: unavailable
                })
            ),
            7
        );
        scope.assert.equal(
            ceiling({
                ...host,
                snapshot: {
                    ...host.snapshot,
                    capacity: {
                        ...host
                            .snapshot
                            .capacity,
                        loadAverage: { ...unavailable, unit: 'load' }
                    }
                }
            }),
            7
        );
        return scope.assert.collect();
    }),
    test('records supervised and uncalibrated ceilings without inventing host evidence', function (scope) {
        const facts = resolveBenchmarkPlacement({
            definitions: [ definition() ],
            host: quietHost(),
            processModel: 'supervised-process'
        });
        scope.assert.equal(facts.maximumWorkers, 1);
        scope.assert.equal(facts.limits.at(-1)?.reason, 'process-model');
        return scope.assert.collect();
    })
]);
