import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as execution } from './property-execution.test.ts';
import { testNode as reporting } from './property-reporting.test.ts';
import { testNode as progress } from './property-reporting-progress.test.ts';

export const testNode = suite('property results', [ execution, reporting, progress ]);
