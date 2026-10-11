import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { parseFrozenMicrotestPolicy, policyBaselineCommand } from './frozen-run-policy.ts';
import { createSupervisedCollectCommand, createSupervisedRunCommand } from './run-isolated-command.ts';
import { supervisedCommandFields } from './run-command-schema.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

export const frozenSupervisedCommandSchema: z.ZodType<SupervisedChildCommand> = z
    .strictObject({
        ...supervisedCommandFields,
        kind: z.enum([ 'collect-frozen', 'run-frozen' ]),
        policy: frozenMicrotestPolicySchema
    })
    .transform(function validateFrozenCommand(command) {
        const policy = parseFrozenMicrotestPolicy(command.policy);
        const baseline = policyBaselineCommand(policy);
        const profile = { ...policy.profile, reporters: null };
        const source = { kind: 'frozen-policy' as const, policy };
        const expected = command.kind === 'collect-frozen'
            ? createSupervisedCollectCommand(baseline, profile, policy.files, source)
            : createSupervisedRunCommand(baseline, profile, policy.files, source);
        if (!isDeepStrictEqual(command, expected)) {
            throw new TypeError('Supervised command conflicts with frozen policy.');
        }
        return { ...command, policy };
    });
