import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { singleAssertionUses } from './assertion-reference-uses.ts';
import { compositeAssertionFactories } from './authoring-contracts.ts';
import { bindingAnalysis } from './binding-analysis.ts';
import { forwardedBuiltIn } from './composite-forwarding.ts';

type Node = Readonly<Tree.Node>;

const referenceSites: ReadonlySet<NodeType> = new Set([
    NodeType.CallExpression,
    NodeType.MemberExpression,
    NodeType.Identifier,
    NodeType.AssignmentExpression,
    NodeType.ObjectExpression,
    NodeType.ArrayExpression
]);

function isAliasValue(node: Node): boolean {
    const { parent } = node;
    return parent?.type === NodeType.VariableDeclarator ||
        parent?.type === NodeType.AssignmentExpression && parent.right === node;
}

function referenceObservations(node: Node): readonly Node[] {
    if (node.type === NodeType.AssignmentExpression && node.left.type === NodeType.MemberExpression) {
        return [ node, node.left.object ];
    }
    return referenceSites.has(node.type) || isAliasValue(node) ? [ node ] : [];
}

export const noSingleUseTrivialAssertion: TSESLint.RuleModule<'trivialAssertion'> = {
    meta: {
        type: 'suggestion',
        schema: [],
        messages: {
            trivialAssertion: 'Use the built-in {{check}} check directly for this single-use composite assertion.'
        }
    },
    create(context) {
        const source = context.sourceCode;
        const calls: Readonly<Tree.CallExpression>[] = [];
        const members: Readonly<Tree.MemberExpression>[] = [];

        return bindingAnalysis(source, function report(analysis) {
            const checks = new Map<Readonly<Tree.CallExpression>, string>();
            for (const call of compositeAssertionFactories(source, analysis, calls)) {
                const check = forwardedBuiltIn(call, analysis);
                if (check !== null) {
                    checks.set(call, check);
                }
            }
            if (checks.size === 0) {
                return;
            }
            const singleUses = singleAssertionUses(source, analysis, { calls, members }, new Set(checks.keys()));
            checks.forEach(function (check, node) {
                if (singleUses.has(node)) {
                    context.report({ node, messageId: 'trivialAssertion', data: { check } });
                }
            });
        }, {
            stableOperands: false,
            query: referenceObservations,
            visit(node) {
                if (node.type === NodeType.CallExpression) {
                    calls.push(node);
                }
                if (node.type === NodeType.MemberExpression) {
                    members.push(node);
                }
            }
        });
    }
};
