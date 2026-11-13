import { defineTestFamily } from '../../../packages/engine/engine.entry-point.ts';

export const family = defineTestFamily({
    id: '@example/transport-runtime',
    version: '1',
    module: { moduleUrl: import.meta.url, exportName: 'family' },
    features: {
        execution: 'runtime',
        processModels: [ 'in-process', 'supervised-process', 'worker-pool' ],
        profileOptions: []
    },
    parseSettings(input: unknown) {
        if (input !== null) {
            throw new TypeError('Expected null settings.');
        }
        return null;
    },
    async load() {
        return {
            async prepare(input) {
                return {
                    testPlan: input.expandVariants([ { key: 'first', facts: null }, { key: 'second', facts: null } ]),
                    facts: { source: 'original' },
                    async collect({ workIds }) {
                        return { kind: 'runtime', facts: { selected: workIds.length } };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});
