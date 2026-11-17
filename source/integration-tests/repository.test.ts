import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as benchmarks } from './suites/benchmarks.test.ts';
import { testNode as compiler } from './suites/compiler.test.ts';
import { testNode as engine } from './suites/engine.test.ts';
import { testNode as eslint } from './suites/eslint.test.ts';
import { testNode as persistence } from './suites/persistence.test.ts';
import { testNode as resources } from './suites/resources.test.ts';
import { testNode as runner } from './suites/runner.test.ts';
import { testNode as stryker } from './suites/stryker.test.ts';

export const testNode = createSuite({
    title: 'repository integration tests',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ benchmarks, compiler, engine, eslint, persistence, resources, runner, stryker ]
});

await runIfMain(import.meta, testNode);
