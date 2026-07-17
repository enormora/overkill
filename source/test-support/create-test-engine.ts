import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createEngine, type Engine } from '../engine/engine.ts';

export function createTestEngine(): Engine {
    return createEngine({ wallClock: createDeterministicWallClock() });
}
