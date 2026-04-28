function isSessionUserMember(node) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    (node.property.name === 'organisationId' || node.property.name === 'role') &&
    node.object?.type === 'MemberExpression' &&
    !node.object.computed &&
    node.object.property.type === 'Identifier' &&
    node.object.property.name === 'user' &&
    node.object.object?.type === 'Identifier' &&
    node.object.object.name === 'session'
  )
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prefer shared auth guards over ad hoc session.user authorisation checks',
    },
    schema: [],
    messages: {
      useGuard: 'Use helpers from @/lib/auth/guards or @/lib/actions/action-auth instead of raw session.user authz checks.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (isSessionUserMember(node.left) || isSessionUserMember(node.right)) {
          context.report({ node, messageId: 'useGuard' })
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'includes' &&
          node.arguments.some((arg) => isSessionUserMember(arg))
        ) {
          context.report({ node, messageId: 'useGuard' })
        }
      },
    }
  },
}

export default rule
