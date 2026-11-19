import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as fixTests } from './rule-fixes.test.ts';
import { testNode as exampleTests } from './rule-tests.test.ts';
import { testNode as parserTests } from './rule-parsers.test.ts';
import { testNode as controlTests } from './rule-controls.test.ts';
import { testNode as sdkTests } from './rule-sdk.test.ts';
import { testNode as optionSchemas } from './rule-option-schemas.test.ts';
import { testNode as exampleContracts } from './rule-example-contracts.test.ts';
import { testNode as replayControls } from './rule-replay-controls.test.ts';

export const testNode = authoredSuite('ESLint rule-testing package', [
    exampleTests,
    parserTests,
    controlTests,
    fixTests,
    sdkTests,
    optionSchemas,
    exampleContracts,
    replayControls
]);
