import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as records } from './replay-record-validation.test.ts';
import { testNode as hedging } from './replay-hedging.test.ts';
import { testNode as publicSurfaces } from './replay-public-surfaces.test.ts';
import { testNode as invalid } from './replay-trace-invalid.test.ts';
import { testNode as binding } from './replay-binding.test.ts';
import { testNode as decisions } from './replay-trace-decisions.test.ts';
import { testNode as trace } from './replay-trace.test.ts';

export const testNode = authoredSuite('replay commands', [
    trace,
    binding,
    decisions,
    invalid,
    publicSurfaces,
    hedging,
    records
]);
