import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod/v4';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { parseFrozenMicrotestPolicy, policyBaselineCommand } from './frozen-run-policy.ts';
import { createSupervisedCollectCommand, createSupervisedRunCommand } from './run-isolated-command.ts';
import { supervisedCommandFields } from './run-command-schema.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';
import { executionTransportSchema } from './execution-session-schema.ts';

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
            ? createSupervisedCollectCommand(baseline, profile, policy.files, { source, normalization: null })
            : createSupervisedRunCommand(baseline, profile, policy.files, { source, normalization: null });
        const normalized = expected.kind === 'run-session'
            ? Object.fromEntries(
                Object.entries({ ...expected, kind: 'run-frozen' }).filter(function ([ key ]) {
                    return key !== 'session';
                })
            )
            : expected;
        if (!isDeepStrictEqual(command, normalized)) {
            throw new TypeError('Supervised command conflicts with frozen policy.');
        }
        return { ...command, policy };
    });

export const sessionSupervisedCommandSchema = z
    .strictObject({
        ...supervisedCommandFields,
        kind: z.literal('run-session'),
        policy: frozenMicrotestPolicySchema,
        session: executionTransportSchema
    })
    .transform(function ({ session, ...command }) {
        const validated = frozenSupervisedCommandSchema.parse({ ...command, kind: 'run-frozen' });
        return { ...validated, kind: 'run-session' as const, policy: command.policy, session };
    });
