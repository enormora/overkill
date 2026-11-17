export type MetricProvenance = {
    readonly collector: string;
    readonly scope: 'custom' | 'process' | 'region' | 'runtime' | 'thread';
    readonly unit: string;
};

type MetricReadingStates = {
    readonly available: {
        readonly availability: 'available';
        readonly value: number;
        readonly provenance: MetricProvenance;
    };
    readonly unavailable: {
        readonly availability: 'unavailable';
        readonly reason: string;
        readonly provenance: MetricProvenance;
    };
};
export type MetricReading = MetricReadingStates[keyof MetricReadingStates];
