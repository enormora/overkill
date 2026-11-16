import { runIfMain } from '#test-runner';
import { suite } from './packages/test/test.entry-point.ts';
import { testNode as graphTests } from './implementation-graph.test.ts';
import { testNode as cancellationTests } from './implementation-cancellation.test.ts';
import { testNode as sourceMapTests } from './implementation-source-map.test.ts';
import { testNode as sourceTests } from './implementation-source.test.ts';
import { testNode as admissionTests } from './implementation-admission.test.ts';

export const testNode = suite('portable module resolution', [
    graphTests,
    cancellationTests,
    sourceMapTests,
    sourceTests,
    admissionTests
]);
await runIfMain(import.meta, testNode);
