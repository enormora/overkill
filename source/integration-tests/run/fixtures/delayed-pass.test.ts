import {
    clearInterval as clearNodeInterval,
    setInterval as setNodeInterval,
    setTimeout as scheduleTimeout
} from 'node:timers';
import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

const delayMilliseconds = 75;
const allocationBytes = 1024 * 1024;
const allocationIntervalMilliseconds = 1;

export const testNode = createTestCase({
    async body(scope) {
        const allocations: Uint8Array[] = [];
        const allocationInterval = setNodeInterval(function allocateMemory() {
            allocations.push(new Uint8Array(allocationBytes));
        }, allocationIntervalMilliseconds);

        try {
            await new Promise(function wait(resolve) {
                scheduleTimeout(resolve, delayMilliseconds);
            });
        } finally {
            clearNodeInterval(allocationInterval);
        }

        scope.assert.equal(allocations.length > 0, true);
        scope.assert.true(true, { message: 'passes after delay' });

        return scope.assert.collect();
    },
    metadata: {},
    name: 'delays'
});
