import { suite } from '@overkill-dev/test';

import { testNode as coverageSources } from './coverage-sources.test.ts';
import { testNode as failureEvidence } from './failure-evidence.test.ts';

export const testNode = suite('source and artifact persistence', [ coverageSources, failureEvidence ]);
