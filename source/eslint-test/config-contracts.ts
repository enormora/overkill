import assert from 'node:assert/strict';
import type { ConfigContract, ConfigInput, ConfigObservation } from './config-definition.ts';
import { fatalDiagnostics, lintConfigSource, observeConfigSource, type ConfigExecution } from './config-execution.ts';
import { applyRuleEdits } from './rule-fixes.ts';
import { projectFailure } from './config-errors.ts';

export async function validConfigSyntax(execution: ConfigExecution, input: ConfigInput): Promise<boolean> {
    const parsed = await lintConfigSource(execution, input, 'parse');
    const fatal = fatalDiagnostics(parsed.messages);
    for (const message of fatal) {
        assert.ok(Number.isFinite(message.line) && message.line > 0, `Parser setup failed: ${message.message}`);
    }
    return fatal.length === 0;
}

async function assertSyntax(execution: ConfigExecution, input: ConfigInput): Promise<void> {
    const parsed = await lintConfigSource(execution, input, 'parse');
    assert.deepEqual(fatalDiagnostics(parsed.messages), [], 'An edit produced invalid syntax.');
}

async function stableFixes(execution: ConfigExecution, input: ConfigInput, maxRounds: number): Promise<void> {
    let { code } = input;
    for (let round = 0; round < maxRounds; round += 1) {
        const fixed = await lintConfigSource(execution, { ...input, code }, 'fix');
        if (
            fixed.output === code && fixed.messages.every(function noFix(message) {
                return message.fix === undefined;
            })
        ) {
            return;
        }
        await assertSyntax(execution, { ...input, code: fixed.output });
        code = fixed.output;
    }
    throw new Error(`Autofixes did not stabilize within ${maxRounds} complete ESLint fix runs.`);
}

async function checkSuggestions(
    execution: ConfigExecution,
    input: ConfigInput,
    observation: ConfigObservation
): Promise<void> {
    for (const message of observation.messages) {
        const suggestions = message.suggestions ?? [];
        for (const suggestion of suggestions) {
            await assertSyntax(execution, { ...input, code: applyRuleEdits(input.code, [ suggestion.fix ]) });
        }
    }
}

async function observeContract(
    execution: ConfigExecution,
    input: ConfigInput,
    contract: ConfigContract
): Promise<ConfigObservation> {
    const observation = await observeConfigSource(
        execution,
        input,
        [ 'fix-syntax', 'fix-stability', 'repeatability' ].includes(contract.kind)
    );
    assert.deepEqual(fatalDiagnostics(observation.messages), [], 'Unexpected parser failure.');
    if (contract.kind === 'fix-syntax') {
        await assertSyntax(execution, { ...input, code: observation.output });
    } else if (contract.kind === 'suggestion-syntax') {
        await checkSuggestions(execution, input, observation);
    } else if (contract.kind === 'fix-stability') {
        await stableFixes(execution, input, contract.maxRounds);
    }
    return observation;
}

export async function checkConfigContract(
    execution: ConfigExecution,
    input: ConfigInput,
    contract: ConfigContract
): Promise<ConfigObservation> {
    try {
        return await observeContract(execution, input, contract);
    } catch (error) {
        throw projectFailure(error, execution.context.root, execution.context.signal);
    }
}
