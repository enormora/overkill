import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';

import { testNode as resources } from './replay-resource.test.ts';

import { testNode as selection } from './replay-selection.test.ts';

import { testNode as dispatcher } from './replay-dispatcher.test.ts';

export const testNode = suite('replay public surfaces', [ resources, selection, dispatcher ]);
await runIfMain(import.meta, testNode);
