import { CaseRunnerError } from '../engine/run-result.ts';
import type { BenchmarkGarbageCollectionResult } from '../engine/benchmark-result.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';

export type BenchmarkGarbageCollection = {
    readonly validate: () => void;
    readonly collect: () => void;
    readonly snapshot: () => BenchmarkGarbageCollectionResult;
};

export function createBenchmarkGarbageCollection(input: SamplingSessionInput): BenchmarkGarbageCollection {
    const capability = input.scope.benchmarkEnvironment?.garbageCollection ?? {
        kind: 'unavailable',
        reason: 'Forced garbage collection requires supervised or hosted benchmark execution.'
    };
    let completed = 0;
    let failures = 0;
    return {
        validate() {
            if (input.lifecycle.garbageCollection !== 'off' && capability.kind === 'unavailable') {
                throw new CaseRunnerError(capability.reason, { subtype: 'measurement', cause: null });
            }
        },
        collect() {
            if (input.lifecycle.garbageCollection === 'off' || input.scope.signal.aborted) {
                return;
            }
            if (capability.kind === 'unavailable') {
                throw new CaseRunnerError(capability.reason, { subtype: 'measurement', cause: null });
            }
            try {
                capability.collect();
                completed += 1;
            } catch (error: unknown) {
                failures += 1;
                throw new CaseRunnerError('Benchmark garbage collection failed.', {
                    subtype: 'measurement',
                    cause: error
                });
            }
        },
        snapshot() {
            return input.lifecycle.garbageCollection === 'off'
                ? { mode: 'off' }
                : { mode: 'after-sample', completed, failures };
        }
    };
}
