import assert from 'node:assert/strict';
import type { ConfigContract, ConfigInput, ConfigObservation } from './config-definition.ts';
import {
    lintConfigSource,
    collectConfigObservation,
    type ConfigSourceLint,
    type ConfigExecution
} from './config-execution.ts';
import { fatalDiagnostics } from './diagnostic-expectations.ts';
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

async function assertSyntax(execution: ConfigExecution, input: ConfigInput, lint: ConfigSourceLint): Promise<void> {
    const parsed = await lint(execution, input, 'parse');
    assert.deepEqual(fatalDiagnostics(parsed.messages), [], 'An edit produced invalid syntax.');
}

async function stableFixes(
    execution: ConfigExecution,
    input: ConfigInput,
    maxRounds: number,
    lint: ConfigSourceLint
): Promise<void> {
    let { code } = input;
    for (let round = 0; round < maxRounds; round += 1) {
        const fixed = await lint(execution, { ...input, code }, 'fix');
        if (
            fixed.output === code && fixed.messages.every(function noFix(message) {
                return message.fix === undefined;
            })
        ) {
            return;
        }
        await assertSyntax(execution, { ...input, code: fixed.output }, lint);
        code = fixed.output;
    }
    throw new Error(`Autofixes did not stabilize within ${maxRounds} complete ESLint fix runs.`);
}

async function checkSuggestions(
    execution: ConfigExecution,
    input: ConfigInput,
    observation: ConfigObservation,
    lint: ConfigSourceLint
): Promise<void> {
    for (const message of observation.messages) {
        const suggestions = message.suggestions ?? [];
        for (const suggestion of suggestions) {
            await assertSyntax(execution, { ...input, code: applyRuleEdits(input.code, [ suggestion.fix ]) }, lint);
        }
    }
}

async function observeContract(
    execution: ConfigExecution,
    input: ConfigInput,
    contract: ConfigContract,
    lint: ConfigSourceLint
): Promise<ConfigObservation> {
    const observation = await collectConfigObservation(
        execution,
        input,
        [ 'fix-syntax', 'fix-stability', 'repeatability' ].includes(contract.kind),
        lint
    );
    assert.deepEqual(fatalDiagnostics(observation.messages), [], 'Unexpected parser failure.');
    if (contract.kind === 'fix-syntax') {
        await assertSyntax(execution, { ...input, code: observation.output }, lint);
    } else if (contract.kind === 'suggestion-syntax') {
        await checkSuggestions(execution, input, observation, lint);
    } else if (contract.kind === 'fix-stability') {
        await stableFixes(execution, input, contract.maxRounds, lint);
    }
    return observation;
}

export async function evaluateConfigContract(
    execution: ConfigExecution,
    input: ConfigInput,
    contract: ConfigContract,
    lint: ConfigSourceLint
): Promise<ConfigObservation> {
    try {
        return await observeContract(execution, input, contract, lint);
    } catch (error) {
        throw projectFailure(error, execution.context.root, execution.context.signal);
    }
}

export async function checkConfigContract(
    execution: ConfigExecution,
    input: ConfigInput,
    contract: ConfigContract
): Promise<ConfigObservation> {
    return await evaluateConfigContract(execution, input, contract, lintConfigSource);
}
