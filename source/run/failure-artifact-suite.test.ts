import { suite } from '@overkill-dev/test';

import { testNode as boundaries } from './boundary-failure-artifacts.test.ts';
import { testNode as terminalReports } from './run-result-reporting.test.ts';

export const testNode = suite('integration failure artifacts', [ boundaries, terminalReports ]);
