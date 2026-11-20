import { suite } from '@overkill-dev/test';
import { testNode as stream } from '../../attachments/failure-artifact-stream.test.ts';
import { testNode as store } from '../../run/attachment-store-policy.test.ts';
import { testNode as listener } from '../../run/attachment-listener-policy.test.ts';
import { testNode as witnesses } from '../../run/witness-attachment-retention.test.ts';
import { testNode as files } from '../../run/attachment-file-retention.test.ts';
import { testNode as connection } from '../../run/attachment-connection-policy.test.ts';

import { testNode as inline } from '../../run/inline-attachment-ownership.test.ts';
import { testNode as coordination } from '../../run/attachment-coordination.test.ts';
import { testNode as recording } from '../../run/attachment-recording.test.ts';

export const testNode = suite('attachment ownership', [
    stream,
    store,
    listener,
    witnesses,
    files,
    inline,
    coordination,
    recording,
    connection
]);
