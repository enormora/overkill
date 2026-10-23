import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as primitives } from './generator-primitives.test.ts';
import { testNode as composition } from './generator-composition.test.ts';
import { testNode as recursion } from './generator-recursion.test.ts';
import { testNode as lifecycle } from './generator-lifecycle.test.ts';

export const testNode = suite('generators', [ primitives, composition, recursion, lifecycle ]);

await runIfMain(import.meta, testNode);
