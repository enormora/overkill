export type ResourceUsageSnapshot = {
    readonly activeResourceCount: number;
    readonly activeResourceTypes: readonly string[];
    readonly capturedAtMicroseconds: number;
    readonly javaScriptEngineHeapBytes: number;
    readonly residentSetBytes: number;
};

export type RunResourceUsage = {
    readonly activeResourceTypes: readonly string[];
    readonly end: ResourceUsageSnapshot;
    readonly peakActiveResourceCount: number;
    readonly peakJavaScriptEngineHeapBytes: number;
    readonly peakResidentSetBytes: number;
    readonly peakResidentSetGrowthBytesPerSecond: number;
    readonly sampleCount: number;
    readonly start: ResourceUsageSnapshot;
};

export type RunResourceUsageTracker = {
    readonly finish: () => RunResourceUsage;
    readonly start: (onSample?: (snapshot: ResourceUsageSnapshot) => void) => void;
};
