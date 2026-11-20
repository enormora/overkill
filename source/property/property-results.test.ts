import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as execution } from './property-execution.test.ts';
import { testNode as reporting } from './property-reporting.test.ts';
import { testNode as diagnostics } from './property-diagnostics.test.ts';
import { testNode as progress } from './property-reporting-progress.test.ts';

export const testNode = authoredSuite('property results', [ execution, reporting, progress, diagnostics ]);
