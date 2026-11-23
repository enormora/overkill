import { suite, test } from '@overkill-dev/test';
import * as parser from '@typescript-eslint/parser';
import { AST_NODE_TYPES as NodeType, TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import {
    bindingAnalysis,
    type BindingAnalysis
} from '../../eslint-plugin/binding-analysis.ts';
import type { BindingOrigin, FunctionNode } from '../../eslint-plugin/binding-origin.ts';
import { publishedAuthorNames } from '../../eslint-plugin/published-author-names.ts';

type Provenance = {
    readonly imports: readonly (string | null)[];
    readonly scopes: readonly (readonly string[] | null)[];
};

type Observations = Provenance & { readonly errors: readonly string[]; };

function bodyProperty(node: Readonly<Tree.Node> | undefined, key: string): Tree.Node | undefined {
    if (node?.type !== NodeType.ObjectExpression) {
        return undefined;
    }
    return node
        .properties
        .find(function (property): property is Tree.Property {
            return property.type === NodeType.Property && !property.computed &&
                property.key.type === NodeType.Identifier && property.key.name === key;
        })
        ?.value;
}

type BodyContract = {
    readonly body: (call: Readonly<Tree.CallExpression>) => Readonly<Tree.Node> | undefined;
    readonly index: number;
};

const bodyContracts = new Map<string, BodyContract>([
    [ '@overkill-dev/test:test', {
        body(call) {
            return call.arguments[1] ?? bodyProperty(call.arguments[0], 'body');
        },
        index: 0
    } ],
    [ '@overkill-dev/test:table', {
        body(call) {
            return bodyProperty(call.arguments[0], 'test');
        },
        index: 0
    } ],
    [ '@overkill-dev/test:defineParameterizedTestBody', {
        body(call) {
            return call.arguments[0];
        },
        index: 0
    } ],
    [ '@overkill-dev/engine:createTestCase', {
        body(call) {
            return bodyProperty(call.arguments[0], 'body');
        },
        index: 0
    } ],
    [ '@overkill-dev/test/property:property', {
        body(call) {
            return bodyProperty(call.arguments[0], 'test');
        },
        index: 1
    } ]
]);

type ScopeOwner = { readonly body: FunctionNode; readonly index: number; };

function importName(origin: BindingOrigin | null): string | null {
    return origin?.root.kind === 'import' ? [ origin.root.source, ...origin.path ].join(':') : null;
}

function owner(analysis: BindingAnalysis, call: Readonly<Tree.CallExpression>): ScopeOwner | null {
    const name = importName(analysis.originOf(call.callee));
    const contract = name === null ? undefined : bodyContracts.get(name);
    if (contract === undefined) {
        return null;
    }
    const body = contract.body(call);
    if (body === undefined) {
        return null;
    }
    const origin = analysis.originOf(body);
    return origin?.root.kind === 'function' ? { body: origin.root.node, index: contract.index } : null;
}

function scopePath(origin: BindingOrigin | null, owners: readonly ScopeOwner[]): readonly string[] | null {
    if (origin?.root.kind !== 'parameter') {
        return null;
    }
    const { root } = origin;
    const ownsParameter = owners.some(function (candidate) {
        return candidate.body === root.owner && candidate.index === root.index;
    });
    return ownsParameter ? origin.path : null;
}

function probe(analysis: BindingAnalysis, calls: readonly Tree.CallExpression[]): Provenance {
    const owners = calls.flatMap(function (call) {
        return owner(analysis, call) ?? [];
    });
    const observations = calls.flatMap(function probeCall(call) {
        const { callee } = call;
        const [ argument ] = call.arguments;
        return callee.type === NodeType.Identifier && argument !== undefined
            ? [ { name: callee.name, origin: analysis.originOf(argument) } ]
            : [];
    });
    return {
        imports: observations.flatMap(function ({ name, origin }) {
            return name === 'probeImport' ? [ importName(origin) ] : [];
        }),
        scopes: observations.flatMap(function ({ name, origin }) {
            return name === 'probeScope' ? [ scopePath(origin, owners) ] : [];
        })
    };
}

function observeBindings(code: string): Observations {
    let observed: Provenance = { imports: [], scopes: [] };
    const rule: TSESLint.RuleModule<never> = {
        meta: { type: 'problem', messages: {}, schema: [] },
        create(context) {
            const calls: Tree.CallExpression[] = [];
            return {
                ...bindingAnalysis(context.sourceCode, function (analysis) {
                    observed = probe(analysis, calls);
                }),
                CallExpression(node) {
                    calls.push(node);
                }
            };
        }
    };
    const linter = new TSESLint.Linter();
    const messages = linter.verify(code, [ {
        files: [ '**/*.ts' ],
        languageOptions: { parser },
        plugins: { fixture: { rules: { provenance: rule } } },
        rules: { 'fixture/provenance': 'error' }
    } ], { filename: 'fixture.ts' });
    return {
        ...observed,
        errors: messages.map(function (message) {
            return message.message;
        })
    };
}

const testImport = '@overkill-dev/test:test';
const tableImport = '@overkill-dev/test:table';

export const testNode = suite('static authoring binding analysis', [
    test('follows imports and local aliases using lexical identity', function (scope) {
        const observed = observeBindings(`
            import { test as authored } from '@overkill-dev/test';
            import * as syntax from '@overkill-dev/test';
            import type { table as TypeOnly } from '@overkill-dev/test';
            const key = 'test';
            const container = { inner: { declared: syntax[key] } };
            const { inner: { declared: alias } } = container;
            const [copied] = [alias as typeof authored];
            probeImport(copied);
            probeImport(authored);
            probeImport(TypeOnly);
            { const authored = unrelated; probeImport(authored); }
            probeImport(syntax[dynamic]);
        `);
        scope.assert.deepEqual(observed.errors, []);
        scope.assert.deepEqual(observed.imports, [ testImport, testImport, null, null, null ]);
        return scope.assert.collect();
    }),
    test('uses reaching writes and preserves copied values', function (scope) {
        const observed = observeBindings(`
            import { test, table } from '@overkill-dev/test';
            let current;
            var legacy = table;
            probeImport(current);
            current = test;
            const copied = current;
            probeImport(current);
            if (condition) current = table;
            probeImport(current);
            if (condition) { current = test; } else { current = test; }
            probeImport(current);
            while (condition) { current = table; probeImport(current); }
            probeImport(current);
            [current, legacy] = [legacy, current];
            probeImport(current);
            probeImport(copied);
            const agreed = condition ? test : test;
            probeImport(agreed);
            current = test;
            for (current of values) { probeImport(current); }
            probeImport(current);
            function check() {
                let current = test;
                if (condition) { current = table; return; }
                probeImport(current);
            }
        `);
        scope.assert.deepEqual(observed.errors, []);
        scope.assert.deepEqual(observed.imports, [
            null,
            testImport,
            null,
            testImport,
            tableImport,
            null,
            tableImport,
            testImport,
            testImport,
            null,
            null,
            testImport
        ]);
        return scope.assert.collect();
    }),
    test('tracks property writes across aliases and forgets escaped objects', function (scope) {
        const observed = observeBindings(`
            import { test, table } from '@overkill-dev/test';
            const holder = { current: test, other: table };
            const alias = holder;
            const copy = alias.current;
            alias['current'] = table;
            probeImport(holder.current);
            probeImport(copy);
            if (condition) alias.current = test;
            probeImport(holder.current);
            probeImport(holder.other);
            opaque(alias);
            probeImport(holder.other);
            const fresh = { current: test };
            fresh[key] = table;
            probeImport(fresh.current);
            const getter = { get current() { return test; } };
            probeImport(getter.current);
            const left = { current: test };
            const right = { current: test };
            const either = condition ? left : right;
            either.current = table;
            probeImport(left.current);
            probeImport(right.current);
        `);
        scope.assert.deepEqual(observed.errors, []);
        scope.assert.deepEqual(observed.imports, [
            tableImport,
            testImport,
            null,
            tableImport,
            null,
            null,
            null,
            null,
            null
        ]);
        return scope.assert.collect();
    }),
    test('proves callback ownership through authoring call and parameter identity', function (scope) {
        const observed = observeBindings(`
            import * as authoring from '@overkill-dev/test';
            import { createTestCase as makeCase } from '@overkill-dev/engine';
            import { gen, property } from '@overkill-dev/test/property';
            import type { TestScope } from '@overkill-dev/test';
            import { test as fake } from 'other-package';
            const { test: authored, table, defineMacro, defineParameterizedTestBody } = authoring;
            const registry = { run: authored };
            const body = ({ assert: checks }: TestScope) => {
                probeScope(checks.equal);
                return checks.collect();
            };
            registry.run('positional', body);
            authored({ title: 'object form', body(context) {
                const alias = context;
                const { require: { defined } } = alias;
                probeScope(defined);
                function shadow(context) { probeScope(context.assert); }
                function nested() { probeScope(alias.plan); }
                return context.assert.collect();
            } });
            table({ title: 'table', cases: [{ assert: false }],
                test(caseScope) { probeScope(caseScope.assert); return caseScope.assert.collect(); },
                caseTitle(scope) { probeScope(scope.assert); return 'row'; } });
            defineMacro((scope: { assert: unknown }) => {
                probeScope(scope.assert);
                return authored('macro', renamed => {
                    probeScope(renamed.plan);
                    return renamed.assert.collect();
                });
            });
            defineParameterizedTestBody<{ assert: unknown }>((context, data) => {
                probeScope(context.assert);
                probeScope(data.assert);
                return context.assert.collect();
            });
            makeCase({ title: 'direct engine', annotations: {}, controls: {},
                definitionLocations: [{ kind: 'unknown' }],
                body(ctx) { probeScope(ctx.assert); return ctx.assert.collect(); } });
            property({ title: 'property', generator: gen.integer(), test(value, sample) {
                probeScope(value);
                probeScope(sample.assert);
                return sample.assert.collect();
            } });
            fake('fake', scope => { probeScope(scope.assert); });
            function ordinary(scope: TestScope) { probeScope(scope.assert); }
            { const authored = unrelated; authored('shadowed', scope => { probeScope(scope.assert); }); }
        `);
        scope.assert.deepEqual(observed.errors, []);
        scope.assert.deepEqual(observed.scopes, [
            [ 'assert', 'equal' ],
            [ 'require', 'defined' ],
            null,
            [ 'plan' ],
            [ 'assert' ],
            null,
            null,
            [ 'plan' ],
            [ 'assert' ],
            null,
            [ 'assert' ],
            null,
            [ 'assert' ],
            null,
            null,
            null
        ]);
        return scope.assert.collect();
    }),
    test('applies the repository author policy to imported and local aliases', function (scope) {
        const linter = new TSESLint.Linter();
        const messages = linter.verify(
            `
            import { test as renamed, suite } from '@overkill-dev/test';
            renamed('one', callback);
            const run = suite;
            run('two', []);
            { const run = unrelated; run(); }
            suite('three', []);
        `,
            [ {
                files: [ '**/*.ts' ],
                languageOptions: { parser },
                plugins: { fixture: { rules: { names: publishedAuthorNames } } },
                rules: { 'fixture/names': 'error' }
            } ],
            { filename: 'fixture.ts' }
        );
        scope.assert.deepEqual(
            messages.map(function (message) {
                return [ message.line, message.message ];
            }),
            [
                [ 2, 'Use the published test author without an alias.' ],
                [ 5, 'Use the published suite author without an alias.' ]
            ]
        );
        return scope.assert.collect();
    })
]);
