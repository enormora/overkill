import { defineTestFamily } from '../../../packages/engine/engine.entry-point.ts';

const preparations = { count: 0 };

export const family = defineTestFamily({
    id: '@example/stalled-preparation',
    version: '1',
    module: { moduleUrl: import.meta.url, exportName: 'family' },
    features: { execution: 'runtime', processModels: [ 'supervised-process' ], profileOptions: [] },
    parseSettings() {
        return null;
    },
    async load() {
        return {
            async prepare(input) {
                preparations.count += 1;
                if (preparations.count > 1) {
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0);
                }
                return {
                    testPlan: input.testPlan,
                    facts: null,
                    async collect() {
                        return { kind: 'runtime', facts: null };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});
