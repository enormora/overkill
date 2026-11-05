import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as invalid } from './replay-trace-invalid.test.ts';
import { testNode as binding } from './replay-binding.test.ts';
import { testNode as decisions } from './replay-trace-decisions.test.ts';
import { testNode as execution } from './replay-execution.test.ts';
import { testNode as trace } from './replay-trace.test.ts';

export const testNode = suite('replay commands', [ execution, trace, binding, decisions, invalid ]);
await runIfMain(import.meta, testNode);
