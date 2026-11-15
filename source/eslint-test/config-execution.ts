import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ESLint, type Linter } from 'eslint';
import { z } from 'zod';
import type { ConfigContext, ConfigObservation } from './config-definition.ts';
import { projectPath } from './config-project.ts';

export type ConfigExecution = {
    readonly context: ConfigContext;
    readonly configs: readonly Linter.Config[];
    readonly materialized: boolean;
};
type SourceInput = { readonly filename: string; readonly code: string; };
type SourceResult = { readonly output: string; readonly messages: readonly Linter.LintMessage[]; };
const resolvedConfigSchema = z.object({
    rules: z.record(z.string(), z.unknown()).default({}),
    languageOptions: z.record(z.string(), z.unknown()).default({}),
    settings: z.record(z.string(), z.unknown()).default({})
});
export type ResolvedConfig = Readonly<z.infer<typeof resolvedConfigSchema>>;

export function configEngine(execution: ConfigExecution, mode: 'fix' | 'lint' | 'parse'): ESLint {
    return new ESLint({
        cwd: execution.context.root,
        overrideConfigFile: true,
        overrideConfig: Array.from(execution.configs),
        fix: mode === 'fix',
        cache: false,
        ruleFilter: mode === 'parse'
            ? function noRules() {
                return false;
            }
            : function allRules() {
                return true;
            }
    });
}

export async function resolvedConfig(engine: ESLint, filename: string): Promise<ResolvedConfig | undefined> {
    const value: unknown = await engine.calculateConfigForFile(filename);
    return value === undefined ? undefined : resolvedConfigSchema.parse(value);
}

export function fatalDiagnostics(messages: readonly Linter.LintMessage[]): readonly Linter.LintMessage[] {
    return messages.filter(function fatal(message) {
        return message.fatal === true;
    });
}

async function prepareSource(execution: ConfigExecution, input: SourceInput): Promise<string> {
    execution.context.signal.throwIfAborted();
    const filename = projectPath(execution.context.root, input.filename);
    if (execution.materialized) {
        const segments = path.relative(execution.context.root, filename).toLowerCase().split(path.sep);
        assert.equal(segments.includes('node_modules'), false, 'Project inputs must not write into node_modules.');
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, input.code);
    }
    return filename;
}

export async function lintConfigSource(
    execution: ConfigExecution,
    input: SourceInput,
    mode: 'fix' | 'lint' | 'parse'
): Promise<SourceResult> {
    const filePath = await prepareSource(execution, input);
    const engine = configEngine(execution, mode);
    assert.equal(await engine.isPathIgnored(filePath), false, `Unexpected ignored file: ${input.filename}`);
    const results = await engine.lintText(input.code, { filePath, warnIgnored: true });
    execution.context.signal.throwIfAborted();
    assert.equal(results.length, 1, 'Expected exactly one ESLint result.');
    const result = results[0];
    assert.ok(result !== undefined);
    return { output: result.output ?? input.code, messages: result.messages };
}

export async function observeConfigSource(
    execution: ConfigExecution,
    input: SourceInput,
    fixing: boolean
): Promise<ConfigObservation> {
    const linted = await lintConfigSource(execution, input, 'lint');
    const fixed = fixing ? await lintConfigSource(execution, input, 'fix') : linted;
    return {
        filename: input.filename,
        code: input.code,
        output: fixed.output,
        messages: linted.messages,
        fixedMessages: fixed.messages
    };
}

export function stableObservation(observation: ConfigObservation, root: string): ConfigObservation {
    function normalize(message: Linter.LintMessage): Linter.LintMessage {
        return { ...message, message: message.message.replaceAll(root, '<project>') };
    }
    return {
        ...observation,
        messages: observation.messages.map(normalize),
        fixedMessages: observation.fixedMessages.map(normalize)
    };
}
