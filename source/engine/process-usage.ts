export type ProcessUsageSnapshot = {
    readonly activeResourceCount: number;
    readonly activeResourceTypes: readonly string[];
    readonly capturedAtMicroseconds: number;
    readonly javaScriptEngineHeapBytes: number;
    readonly residentSetBytes: number;
};

export type RunProcessUsage = {
    readonly activeResourceTypes: readonly string[];
    readonly end: ProcessUsageSnapshot;
    readonly peakActiveResourceCount: number;
    readonly peakJavaScriptEngineHeapBytes: number;
    readonly peakResidentSetBytes: number;
    readonly peakResidentSetGrowthBytesPerSecond: number;
    readonly sampleCount: number;
    readonly start: ProcessUsageSnapshot;
};

export type RunProcessUsageTracker = {
    readonly finish: () => RunProcessUsage;
    readonly start: (onSample?: (snapshot: ProcessUsageSnapshot) => void) => void;
};
