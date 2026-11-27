import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import type { CompositeCheckBuilder } from '../assert/assertion-extension.ts';
import { compositeAssertionFactories, scopeParameters } from './authoring-contracts.ts';
import { bindingAnalysis, type BindingAnalysis } from './binding-analysis.ts';
import type { BindingOrigin, FunctionNode } from './binding-origin.ts';

type Call = Readonly<Tree.CallExpression>;
type SourceCode = Readonly<TSESLint.SourceCode>;

const equalityNames: readonly (keyof CompositeCheckBuilder)[] = [ 'equal', 'notEqual', 'deepEqual', 'notDeepEqual' ];
const equalityChecks: ReadonlySet<string> = new Set(equalityNames);
const scopedMethodPathLength = 2;

function propertyName(property: Readonly<Tree.Property>): string | null {
    const { key } = property;
    if (key.type === NodeType.Identifier && !property.computed) {
        return key.name;
    }
    return key.type === NodeType.Literal && typeof key.value === 'string' ? key.value : null;
}

function builderField(
    field: Readonly<Tree.Property | Tree.SpreadElement> | undefined
): field is Readonly<Tree.Property> {
    return field?.type === NodeType.Property && field.kind === 'init' && propertyName(field) === 'assert';
}

function localFunction(origin: BindingOrigin | null): FunctionNode | null {
    return origin?.root.kind === 'function' && origin.path.length === 0 ? origin.root.node : null;
}

function builderBody(call: Call, analysis: BindingAnalysis): FunctionNode | null {
    const [ definition ] = call.arguments;
    if (definition?.type !== NodeType.ObjectExpression) {
        return null;
    }
    const field = definition.properties.findLast(function (property) {
        return property.type === NodeType.SpreadElement || [ null, 'assert' ].includes(propertyName(property));
    });
    return builderField(field) ? localFunction(analysis.originOf(field.value)) : null;
}

function isScopeMethod(origin: BindingOrigin): boolean {
    return !origin.builderOnly && origin.path.length === scopedMethodPathLength && origin.path[0] === 'assert';
}

function isBuilderMethod(origin: BindingOrigin, builders: ReadonlySet<FunctionNode | null>): boolean {
    const { root, path } = origin;
    return root.kind === 'parameter' && path.length === 1 && root.index === 0 && builders.has(root.owner);
}

function equalityName(origin: BindingOrigin): string | null {
    const name = origin.path.at(-1);
    return name !== undefined && !origin.preboundOperands && equalityChecks.has(name) ? name : null;
}

function equalityMethod(source: SourceCode, analysis: BindingAnalysis, calls: readonly Call[]) {
    const scopes = scopeParameters(source, analysis, calls);
    const factories = compositeAssertionFactories(source, analysis, calls);
    const builders = new Set(factories.map(function (call) {
        return builderBody(call, analysis);
    }));
    return function check(origin: BindingOrigin): string | null {
        const { root } = origin;
        const name = equalityName(origin);
        if (root.kind !== 'parameter' || name === null) {
            return null;
        }
        if (isBuilderMethod(origin, builders)) {
            return name;
        }
        return isScopeMethod(origin) &&
                scopes.some(function (scope) {
                    return scope.body === root.owner && scope.index === root.index;
                }) ?
            name :
            null;
    };
}

export const noSelfComparison: TSESLint.RuleModule<'selfComparison'> = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            selfComparison: 'Both operands of {{check}} read the same value. Use an independent expected value.'
        }
    },
    create(context) {
        const calls: Call[] = [];
        return bindingAnalysis(context.sourceCode, function report(analysis) {
            const method = equalityMethod(context.sourceCode, analysis, calls);
            for (const call of calls) {
                const expected = call.arguments[1];
                const origin = analysis.originOf(call.callee);
                if (expected !== undefined && origin !== null && analysis.sameStableOperands(call)) {
                    const check = method(origin);
                    if (check !== null) {
                        context.report({ node: expected, messageId: 'selfComparison', data: { check } });
                    }
                }
            }
        }, {
            query: null,
            stableOperands: true,
            visit(node) {
                if (node.type === NodeType.CallExpression) {
                    calls.push(node);
                }
            }
        });
    }
};
