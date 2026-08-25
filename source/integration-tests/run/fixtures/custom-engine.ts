import { createEngine } from '../../../packages/engine/engine.entry-point.ts';

if (typeof process.send !== 'function') {
    throw new TypeError('Custom engine module imported outside the supervised child.');
}

export const engine = createEngine();
export const { createTestCase } = engine;

export function getEngine(): typeof engine {
    return engine;
}

export async function getAsyncEngine(): Promise<typeof engine> {
    return engine;
}

export const invalidEngine = {};
