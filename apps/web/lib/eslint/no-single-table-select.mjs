const COMPLEX_CHAIN_METHODS = new Set([
  'groupBy',
  'having',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'for',
])

const AGGREGATE_CALLEES = new Set([
  'avg',
  'count',
  'countDistinct',
  'max',
  'min',
  'sum',
  'sql',
])

function getPropertyName(memberExpression) {
  if (memberExpression.computed) return null
  if (memberExpression.property.type === 'Identifier') return memberExpression.property.name
  return null
}

function isDatabaseHandle(node) {
  return node?.type === 'Identifier' && (node.name === 'db' || node.name === 'tx')
}

function containsComplexSelection(node, seen = new WeakSet()) {
  if (!node || typeof node !== 'object') return false
  if (seen.has(node)) return false
  seen.add(node)

  if (node.type === 'TaggedTemplateExpression') {
    return node.tag?.type === 'Identifier' && node.tag.name === 'sql'
  }

  if (node.type === 'CallExpression') {
    if (node.callee.type === 'Identifier' && AGGREGATE_CALLEES.has(node.callee.name)) {
      return true
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    if (Array.isArray(value)) {
      if (value.some((entry) => containsComplexSelection(entry, seen))) return true
      continue
    }
    if (containsComplexSelection(value, seen)) return true
  }

  return false
}

function getChainMethodsAfter(node) {
  const methods = []
  let current = node

  while (
    current.parent?.type === 'MemberExpression' &&
    current.parent.object === current &&
    current.parent.parent?.type === 'CallExpression' &&
    current.parent.parent.callee === current.parent
  ) {
    const methodName = getPropertyName(current.parent)
    if (methodName) methods.push(methodName)
    current = current.parent.parent
  }

  return methods
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer db.query.* for straightforward single-table reads',
    },
    schema: [],
    messages: {
      preferQueryApi:
        'Use the relational query API for single-table reads; keep select/from for joins, grouping, or aggregate SQL only.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return
        if (getPropertyName(node.callee) !== 'from') return

        const selectCall = node.callee.object
        if (selectCall?.type !== 'CallExpression' || selectCall.callee.type !== 'MemberExpression') return
        if (getPropertyName(selectCall.callee) !== 'select') return
        if (!isDatabaseHandle(selectCall.callee.object)) return

        const chainMethods = getChainMethodsAfter(node)
        if (chainMethods.some((method) => COMPLEX_CHAIN_METHODS.has(method))) return

        const selection = selectCall.arguments[0]
        if (containsComplexSelection(selection)) return

        context.report({
          node,
          messageId: 'preferQueryApi',
        })
      },
    }
  },
}

export default rule
