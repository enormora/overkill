import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as records } from './replay-record-validation.test.ts';
import { testNode as hedging } from './replay-hedging.test.ts';
import { testNode as publicSurfaces } from './replay-public-surfaces.test.ts';
import { testNode as invalid } from './replay-trace-invalid.test.ts';
import { testNode as binding } from './replay-binding.test.ts';
import { testNode as decisions } from './replay-trace-decisions.test.ts';
import { testNode as execution } from './replay-execution.test.ts';
import { testNode as trace } from './replay-trace.test.ts';

export const testNode = suite('replay commands', [
    execution,
    trace,
    binding,
    decisions,
    invalid,
    publicSurfaces,
    hedging,
    records
]);
await runIfMain(import.meta, testNode);
