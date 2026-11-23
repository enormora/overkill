import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { type BindingAnalysis, bindingAnalysis } from './binding-analysis.ts';

type Author = 'suite' | 'test';

const authoringModule = '@overkill-dev/test';

function isAuthor(name: string | undefined): name is Author {
    return name === 'suite' || name === 'test';
}

function aliasedAuthor(analysis: BindingAnalysis, identifier: Readonly<Tree.Identifier>): Author | null {
    const origin = analysis.originOf(identifier);
    if (origin?.root.kind !== 'import' || origin.root.source !== authoringModule || origin.path.length !== 1) {
        return null;
    }
    const [ author ] = origin.path;
    return isAuthor(author) && author !== identifier.name ? author : null;
}

function renamedImport(node: Readonly<Tree.ImportSpecifier>): Author | null {
    const { parent, imported, local } = node;
    if (parent.source.value !== authoringModule || imported.type !== NodeType.Identifier) {
        return null;
    }
    return isAuthor(imported.name) && imported.name !== local.name ? imported.name : null;
}

export const publishedAuthorNames: TSESLint.RuleModule<'alias'> = {
    meta: {
        type: 'problem',
        schema: [],
        messages: { alias: 'Use the published {{author}} author without an alias.' }
    },
    create(context) {
        const candidates: Readonly<Tree.Identifier>[] = [];
        const reportedImports = new WeakSet<object>();
        return {
            ...bindingAnalysis(context.sourceCode, function reportAliases(analysis) {
                for (const identifier of candidates) {
                    const author = aliasedAuthor(analysis, identifier);
                    if (author !== null && !reportedImports.has(identifier)) {
                        context.report({ node: identifier, messageId: 'alias', data: { author } });
                    }
                }
            }),
            ImportSpecifier(node) {
                const author = renamedImport(node);
                if (author !== null) {
                    context.report({ node, messageId: 'alias', data: { author } });
                    for (const variable of context.sourceCode.getDeclaredVariables(node)) {
                        for (const reference of variable.references) {
                            reportedImports.add(reference.identifier);
                        }
                    }
                }
            },
            CallExpression(node) {
                if (node.callee.type === NodeType.Identifier) {
                    candidates.push(node.callee);
                }
            }
        };
    }
};
