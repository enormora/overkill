import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as recordTests } from './implementation-record.test.ts';

export const testNode = suite('portable implementation runs', [ recordTests ]);
await runIfMain(import.meta, testNode);
