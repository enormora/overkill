import { createPrinter, createScanner, createSourceFile, ScriptTarget, SyntaxKind } from 'typescript';
import { gen, type Generator as PropertyGenerator } from '../packages/property/property.entry-point.ts';
import type { ESLintTestConfig, RuleGeneration, ConfiguredExample } from './rule-definition.ts';

function identifiers(examples: readonly ConfiguredExample[]): readonly string[] {
    const names = new Set([ 'value', 'generated' ]);
    for (const example of examples) {
        const scanner = createScanner(ScriptTarget.Latest, true);
        scanner.setText(example.value.code);
        for (let token = scanner.scan(); token !== SyntaxKind.EndOfFileToken; token = scanner.scan()) {
            if (token === SyntaxKind.Identifier) {
                names.add(scanner.getTokenText());
            }
        }
    }
    return Array.from(names);
}

function expressionInputs(names: readonly string[]): PropertyGenerator<string> {
    const identifier = gen.integer({ min: 0, max: names.length - 1 }).map(function name(index) {
        return names[index] ?? 'value';
    });
    const literal = gen.choice(
        gen.integer({ min: -100, max: 100 }).map(String),
        gen.string({ minLength: 0, maxLength: 20 }).map(JSON.stringify)
    );
    return gen.recursive<string>({
        leaf: gen.choice(identifier, literal),
        maxDepth: 2,
        branch(child) {
            return gen.choice(
                gen.tuple(child, child).map(function binary([ left, right ]) {
                    return `(${left} + ${right})`;
                }),
                gen.array(child, { minLength: 0, maxLength: 4 }).map(function array(values) {
                    return `[${values.join(',')}]`;
                }),
                child.map(function call(value) {
                    return `generated(${value})`;
                })
            );
        }
    });
}

function classicStatement(value: string, kind: number): string {
    const forms = [
        `var value = ${value};`,
        `function generated(value) { return ${value}; }`,
        `if (${value}) { var value = 0; } else { var value = 1; }`,
        `for (var index = 0; index < 3; index++) { var value = ${value}; }`,
        `try { var value = ${value}; } catch (error) { var value = error; }`,
        `var value = { field: ${value} };`,
        `var generated = function(value) { return ${value}; };`
    ];
    return forms[kind % forms.length] ?? forms[0] ?? '';
}

function modernStatement(value: string, kind: number): string {
    const forms = [
        `class Generated { method(value) { return ${value}; } }`,
        `const generated = (value) => ${value};`,
        `let value = ${value};`
    ];
    return forms[kind % forms.length] ?? forms[0] ?? '';
}

function typedStatement(value: string, kind: number): string {
    const forms = [
        `var value: unknown = ${value};`,
        'interface Generated { value: unknown; }',
        'type Generated<Value> = { value: Value };',
        'enum Generated { First, Second }'
    ];
    return forms[kind % forms.length] ?? forms[0] ?? '';
}

const classicStatementCount = 7;
const modernStatementCount = 3;
const typedStatementCount = 4;
const modernLanguageVersion = 6;

function statement(value: string, kind: number, generation: RuleGeneration, modern: boolean): string {
    if (kind < classicStatementCount) {
        return classicStatement(value, kind);
    }
    if (kind < classicStatementCount + modernStatementCount && modern) {
        return modernStatement(value, kind - classicStatementCount);
    }
    if (generation.syntax === 'typescript') {
        return typedStatement(value, kind - classicStatementCount - modernStatementCount);
    }
    return classicStatement(value, kind);
}

export function sourceInputs(
    generation: RuleGeneration,
    config: ESLintTestConfig,
    examples: readonly ConfiguredExample[]
): PropertyGenerator<string> {
    const version = config.languageOptions?.ecmaVersion ?? 'latest';
    const modern = version === 'latest' || typeof version === 'number' && version >= modernLanguageVersion;
    const expressions = expressionInputs(identifiers(examples));
    const statements = gen
        .tuple(
            expressions,
            gen.integer({
                min: 0,
                max: classicStatementCount + modernStatementCount + (generation.syntax === 'typescript'
                    ? typedStatementCount
                    : 0) -
                    1
            })
        )
        .map(function construct([ value, kind ]) {
            return statement(value, kind, generation, modern);
        });
    const printer = createPrinter();
    return gen.array(statements, { minLength: 1, maxLength: 3 }).map(function program(values) {
        return printer.printFile(createSourceFile(
            generation.filename,
            values
                .map(function block(value) {
                    return `{\n${value}\n}`;
                })
                .join('\n'),
            ScriptTarget.Latest
        ));
    });
}
