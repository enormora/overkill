import { defineTestFamily, singleAttemptResult } from '../../../packages/engine/engine.entry-point.ts';

export const family = defineTestFamily({
    id: '@example/transport-analysis',
    version: '1',
    module: { moduleUrl: import.meta.url, exportName: 'family' },
    features: {
        execution: 'analysis',
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
                    testPlan: input.testPlan,
                    facts: { inputs: 'original' },
                    async collect({ workIds }) {
                        return {
                            kind: 'analysis',
                            facts: { selected: workIds.length },
                            async execute({ report }) {
                                for (const workId of workIds) {
                                    await report({ kind: 'case-start', workId });
                                    await report({
                                        kind: 'case-end',
                                        artifacts: [],
                                        result: singleAttemptResult({
                                            id: workId.case,
                                            workId,
                                            definitionLocations: [ { kind: 'unknown' } ],
                                            outcome: { kind: 'pass' },
                                            verdict: 'pass',
                                            durationMicroseconds: 0
                                        }, { index: 0 })
                                    });
                                }
                            }
                        };
                    },
                    async dispose() {
                        return undefined;
                    }
                };
            }
        };
    }
});
