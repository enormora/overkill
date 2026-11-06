import { runIfMain } from '#test-runner';
import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as compatibility } from '../integration-tests/run/runner-replay-compatibility.test.ts';
import { testNode as recorded } from '../integration-tests/run/runner-replay.test.ts';
import { testNode as simulation } from '../integration-tests/run/runner-replay-simulation.test.ts';
import { testNode as witness } from '../integration-tests/run/runner-replay-witness.test.ts';
import { testNode as inputs } from './replay-witness-input.test.ts';

import { testNode as resources } from './replay-resource.test.ts';

import { testNode as selection } from './replay-selection.test.ts';

import { testNode as dispatcher } from './replay-dispatcher.test.ts';

export const testNode = suite('replay public surfaces', [
    recorded,
    witness,
    simulation,
    compatibility,
    inputs,
    resources,
    selection,
    dispatcher
]);
await runIfMain(import.meta, testNode);
