import { AST_NODE_TYPES as NodeType, type TSESLint, type TSESTree as Tree } from '@typescript-eslint/utils';
import { bindingAnalysis, type BindingAnalysis } from './binding-analysis.ts';
import { isFunction, type BindingOrigin, type FunctionNode } from './binding-origin.ts';
import { scopeParameters } from './authoring-contracts.ts';

type Node = Readonly<Tree.Node>;
type Call = Readonly<Tree.CallExpression | Tree.NewExpression>;
type Write = Readonly<Tree.AssignmentExpression>;
type RuleContext = TSESLint.RuleContext<'forward' | 'escape', []>;

function argumentsOf(call: Call): readonly Node[] {
    return call.arguments.map(argument => argument.type === NodeType.SpreadElement ? argument.argument : argument);
}

function enclosingFunction(node: Node): FunctionNode | null {
    for (let parent = node.parent; parent != null; parent = parent.parent) {
        if (isFunction(parent)) {
            return parent;
        }
    }
    return null;
}

function within(node: Node, owner: Node): boolean {
    for (let current: Node | undefined = node; current != null; current = current.parent) {
        if (current === owner) {
            return true;
        }
    }
    return false;
}

function caughtInside(node: Readonly<Tree.ThrowStatement>, owner: FunctionNode): boolean {
    let child: Node = node;
    for (let parent: Node | null | undefined = child.parent; parent != null && parent !== owner; parent = parent.parent) {
        if (parent.type === NodeType.TryStatement && parent.block === child && parent.handler !== null) {
            return true;
        }
        child = parent;
    }
    return false;
}

function returnedExpression(node: Node): boolean {
    return node.parent?.type === NodeType.ArrowFunctionExpression && node.parent.body === node;
}

function writeTargets(node: Node): readonly Node[] {
    switch (node.type) {
        case NodeType.ObjectPattern:
            return node.properties.flatMap(property => writeTargets(
                property.type === NodeType.Property ? property.value : property.argument
            ));
        case NodeType.ArrayPattern:
            return node.elements.flatMap(element => element === null ? [] : writeTargets(element));
        case NodeType.RestElement:
            return writeTargets(node.argument);
        case NodeType.AssignmentPattern:
            return writeTargets(node.left);
        default:
            return [ node ];
    }
}

function transferValues(node: Node): readonly Node[] {
    switch (node.type) {
        case NodeType.CallExpression:
        case NodeType.NewExpression:
            return argumentsOf(node);
        case NodeType.AssignmentExpression:
            return [ node.right, ...writeTargets(node.left).flatMap(target =>
                target.type === NodeType.MemberExpression ? [ target.object ] : []
            ) ];
        case NodeType.ReturnStatement:
        case NodeType.ThrowStatement:
            return node.argument === null ? [] : [ node.argument ];
        default:
            return [];
    }
}

function query(node: Node): readonly Node[] {
    const values = transferValues(node);
    return returnedExpression(node) ? [ ...values, node ] : values;
}

function binding(source: Readonly<TSESLint.SourceCode>, node: Readonly<Tree.Identifier>): TSESLint.Scope.Variable | null {
    for (let scope: TSESLint.Scope.Scope | null = source.getScope(node); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable !== undefined) {
            return variable;
        }
    }
    return null;
}

function storesOutside(
    context: RuleContext,
    analysis: BindingAnalysis,
    owner: FunctionNode,
    write: Write
): boolean {
    return writeTargets(write.left).some(function (target) {
        if (target.type === NodeType.Identifier) {
            const variable = binding(context.sourceCode, target);
            return variable === null || !variable.defs.some(definition => within(definition.node, owner));
        }
        if (target.type === NodeType.MemberExpression) {
            const allocations = analysis.allocationsAt(target.object, write);
            return allocations.length === 0 || allocations.some(allocation => !within(allocation, owner));
        }
        return false;
    });
}

const timers = new Set([ 'setTimeout', 'setInterval', 'setImmediate' ]);

function detachedTimer(context: RuleContext, analysis: BindingAnalysis, call: Call): boolean {
    if (call.parent.type !== NodeType.ExpressionStatement) {
        return false;
    }
    const callee = call.callee;
    const origin = analysis.originOf(callee);
    if (origin?.root.kind === 'import' && (origin.root.source === 'node:timers' || origin.root.source === 'timers')) {
        const method = origin.path.at(-1);
        return method !== undefined && timers.has(method);
    }
    return callee.type === NodeType.Identifier && timers.has(callee.name) &&
        (binding(context.sourceCode, callee)?.defs.length ?? 0) === 0;
}

function isProtected(path: readonly string[]): boolean {
    const [ member ] = path;
    return path.length === 0 || (member === 'plan' && path.length === 1) ||
        ((member === 'assert' || member === 'require') && path.length <= 2);
}

function reportEscapes(
    context: RuleContext,
    analysis: BindingAnalysis,
    calls: readonly Readonly<Tree.CallExpression>[],
    sites: readonly Node[],
    references: readonly Node[]
): void {
    const parameters = scopeParameters(context.sourceCode, analysis, calls);

    function protectedOwner(origin: BindingOrigin | null): FunctionNode | null {
        if (origin?.root.kind !== 'parameter' || !isProtected(origin.path)) {
            return null;
        }
        const { owner, index } = origin.root;
        return parameters.some(parameter => parameter.body === owner && parameter.index === index) ? owner : null;
    }

    const captures = new Map<FunctionNode, Set<FunctionNode>>();
    const usesOfFunction = new Map<FunctionNode, Node[]>();

    function recordCapture(reference: Node, owner: FunctionNode): boolean {
        let changed = false;
        let enclosing = enclosingFunction(reference);
        while (enclosing !== null && enclosing !== owner && within(enclosing, owner)) {
            const owningScopes = captures.get(enclosing) ?? new Set<FunctionNode>();
            if (!owningScopes.has(owner)) {
                owningScopes.add(owner);
                captures.set(enclosing, owningScopes);
                changed = true;
            }
            enclosing = enclosingFunction(enclosing);
        }
        return changed;
    }

    for (const reference of references) {
        const origin = analysis.originOf(reference);
        const owner = protectedOwner(origin);
        if (owner !== null) {
            recordCapture(reference, owner);
        }
        if (origin?.root.kind === 'function' && origin.path.length === 0) {
            const uses = usesOfFunction.get(origin.root.node) ?? [];
            uses.push(reference);
            usesOfFunction.set(origin.root.node, uses);
        }
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const [ callback, uses ] of usesOfFunction) {
            for (const owner of captures.get(callback) ?? []) {
                for (const use of uses) {
                    changed = recordCapture(use, owner) || changed;
                }
            }
        }
    }

    function protectedOwners(value: Node, site: Node, includeCallbacks: boolean): readonly FunctionNode[] {
        return analysis.originsWithin(value, site).flatMap(function (origin) {
            const owner = protectedOwner(origin);
            if (owner !== null) {
                return [ owner ];
            }
            return includeCallbacks && origin.root.kind === 'function' && origin.path.length === 0
                ? Array.from(captures.get(origin.root.node) ?? [])
                : [];
        });
    }

    function reportCall(call: Call): void {
        for (const [ index, argument ] of argumentsOf(call).entries()) {
            if (protectedOwners(argument, call, false).length !== 0) {
                context.report({ node: argument, messageId: 'forward' });
            } else if (index === 0 && detachedTimer(context, analysis, call) &&
                protectedOwners(argument, call, true).some(owner => owner === enclosingFunction(call))) {
                context.report({ node: argument, messageId: 'escape' });
            }
        }
    }

    for (const site of sites) {
        if (site.type === NodeType.CallExpression || site.type === NodeType.NewExpression) {
            reportCall(site);
        } else if (site.type === NodeType.AssignmentExpression) {
            if (site.operator === '=' && protectedOwners(site.right, site, true).some(owner =>
                storesOutside(context, analysis, owner, site)
            )) {
                context.report({ node: site.right, messageId: 'escape' });
            }
        }
        if (site.type === NodeType.ReturnStatement || site.type === NodeType.ThrowStatement || returnedExpression(site)) {
            const value = site.type === NodeType.ReturnStatement || site.type === NodeType.ThrowStatement
                ? site.argument
                : site;
            const owner = enclosingFunction(site);
            if (value !== null && owner !== null &&
                !(site.type === NodeType.ThrowStatement && caughtInside(site, owner)) &&
                protectedOwners(value, site, true).includes(owner)) {
                context.report({ node: value, messageId: 'escape' });
            }
        }
    }
}

export const noScopeEscape: TSESLint.RuleModule<'forward' | 'escape'> = {
    meta: {
        type: 'problem',
        schema: [],
        messages: {
            forward: 'Pass application data or a resource handle instead of an Overkill scope or its assertion API.',
            escape: 'Keep the Overkill scope and its assertion API within the owning test or trial.'
        }
    },
    create(context) {
        const calls: Readonly<Tree.CallExpression>[] = [];
        const sites: Node[] = [];
        const references: Node[] = [];
        return bindingAnalysis(context.sourceCode, function report(result) {
            reportEscapes(context, result, calls, sites, references);
        }, {
            query,
            visit(node) {
                if (query(node).length !== 0) {
                    sites.push(node);
                }
                if (node.type === NodeType.CallExpression) {
                    calls.push(node);
                }
                if (node.type === NodeType.Identifier || node.type === NodeType.MemberExpression) {
                    references.push(node);
                }
            }
        });
    }
};
