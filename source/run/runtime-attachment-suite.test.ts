import { suite } from '@overkill-dev/test';

import { testNode as retention } from './runtime-attachment-retention.test.ts';
import { testNode as worker } from './runtime-attachment-worker.test.ts';
import { testNode as validation } from './runtime-attachment-validation.test.ts';
import { testNode as protocol } from './runtime-attachment-protocol.test.ts';
import { testNode as attachments } from './runtime-attachments.test.ts';
import { testNode as ownership } from './runtime-attachment-ownership.test.ts';

export const testNode = suite('runtime attachments', [
    retention,
    worker,
    validation,
    protocol,
    attachments,
    ownership
]);
