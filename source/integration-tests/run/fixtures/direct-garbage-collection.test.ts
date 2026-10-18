import { createRoot, createTestPlan, execute } from '../../../packages/engine/engine.entry-point.ts';
import { testNode } from './garbage-collection.bench.test.ts';

const result = await execute(createTestPlan(createRoot({
    title: 'direct', children: [ testNode ], annotations: {}, controls: {}
})));
process.stdout.write(JSON.stringify({
    exposed: typeof globalThis.gc === 'function',
    requestedSamples: result.perTest[0]?.benchmark?.samples,
    errors: result.runnerErrors.map((error) => error.subtype)
}));
