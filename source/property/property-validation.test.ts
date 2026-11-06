import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as properties } from './property-suite.test.ts';

export const testNode = suite('property validation', [ properties ]);

await runIfMain(import.meta, testNode);
