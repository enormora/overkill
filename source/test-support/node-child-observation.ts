import { observeChildRuntime, type NodeChildObservation } from '../bench/process-node-observation.ts';

const percentileReading = 7000;
const elapsedNanoseconds = 5000n;
const maximumResidentKilobytes = 8;
type NodeChildObservationFixture = { readonly observation: NodeChildObservation; readonly calls: readonly string[]; };
export function nodeChildObservation(
    count: number
): NodeChildObservationFixture {
    const calls: string[] = [];
    let now = 1000n;
    const observation = observeChildRuntime({
        histogram() {
            return {
                count,
                mean: 2000,
                max: 9000,
                percentile(value) {
                    calls.push(`percentile:${value}`);
                    return percentileReading;
                },
                enable() {
                    calls.push('enable');
                    return true;
                },
                disable() {
                    calls.push('disable');
                    return true;
                }
            };
        },
        utilization(previous) {
            calls.push(previous === undefined ? 'utilization:start' : 'utilization:elapsed');
            return { idle: 1, active: 3, utilization: 0.75 };
        },
        now() {
            const current = now;
            now += elapsedNanoseconds;
            return current;
        },
        cpu() {
            return { user: 100, system: 50 };
        },
        memory() {
            return { rss: 4096, heapUsed: 2048 };
        },
        maximumResidentSetKilobytes() {
            return maximumResidentKilobytes;
        },
        version: 'unit-runtime'
    });
    return { observation, calls };
}
