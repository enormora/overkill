import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as fixTests } from './rule-fixes.test.ts';
import { testNode as exampleTests } from './rule-tests.test.ts';
import { testNode as propertyTests } from './rule-properties.test.ts';
import { testNode as parserTests } from './rule-parsers.test.ts';
import { testNode as controlTests } from './rule-controls.test.ts';
import { testNode as sdkTests } from './rule-sdk.test.ts';
import { testNode as optionSchemas } from './rule-option-schemas.test.ts';
import { testNode as exampleContracts } from './rule-example-contracts.test.ts';
import { testNode as replayControls } from './rule-replay-controls.test.ts';

export const testNode = suite('ESLint rule-testing package', [
    exampleTests,
    propertyTests,
    parserTests,
    controlTests,
    fixTests,
    sdkTests,
    optionSchemas,
    exampleContracts,
    replayControls
]);
