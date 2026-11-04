import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as errors } from './corpus-errors.test.ts';
import { testNode as operations } from './corpus.test.ts';
import { testNode as compatibility } from './corpus-compatibility.test.ts';
import { testNode as commands } from './corpus-cli.test.ts';

export const testNode = suite('property corpus', [ operations, compatibility, commands, errors ]);
await runIfMain(import.meta, testNode);
