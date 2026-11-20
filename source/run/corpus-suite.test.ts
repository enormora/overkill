import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as errors } from './corpus-errors.test.ts';
import { testNode as operations } from './corpus.test.ts';
import { testNode as compatibility } from './corpus-compatibility.test.ts';
import { testNode as commands } from './corpus-cli.test.ts';

export const testNode = authoredSuite('property corpus', [ operations, compatibility, commands, errors ]);
