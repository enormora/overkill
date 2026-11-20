import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as cancellation } from './replay-cancellation-policy.test.ts';

import { testNode as resources } from './replay-resource.test.ts';

import { testNode as selection } from './replay-selection.test.ts';

import { testNode as dispatcher } from './replay-dispatcher.test.ts';

export const testNode = authoredSuite('replay public surfaces', [
    cancellation,
    resources,
    selection,
    dispatcher
]);
