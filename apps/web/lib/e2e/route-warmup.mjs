const optionValueFlags = new Set([
  '--config',
  '--grep',
  '--grep-invert',
  '--max-failures',
  '--output',
  '--project',
  '--repeat-each',
  '--reporter',
  '--retries',
  '--shard',
  '--timeout',
  '--trace',
  '--tsconfig',
  '--ui-host',
  '--ui-port',
  '--update-snapshots',
  '--workers',
])

function normaliseWarmupMode(value) {
  const normalised = String(value ?? '').trim().toLowerCase()
  if (['0', 'false', 'no', 'off', 'skip'].includes(normalised)) return 'skip'
  if (['1', 'true', 'yes', 'on', 'all'].includes(normalised)) return 'all'
  return null
}

export function hasFocusedE2eSpecArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue

    if (arg === '--') {
      return args.slice(index + 1).some((value) => !value.startsWith('-'))
    }

    if (arg.startsWith('--') && arg.includes('=')) {
      continue
    }

    if (optionValueFlags.has(arg)) {
      index += 1
      continue
    }

    if (arg.startsWith('-')) {
      continue
    }

    if (/\.(?:spec|test)\.tsx?$/.test(arg) || arg.includes('/')) {
      return true
    }
  }

  return false
}

export function resolveRouteWarmupMode(args, env = process.env) {
  const configured = normaliseWarmupMode(env.E2E_ROUTE_WARMUP)
  if (configured) return configured

  return hasFocusedE2eSpecArg(args) ? 'skip' : 'all'
}

export function shouldWarmRoutes(env = process.env) {
  return normaliseWarmupMode(env.E2E_ROUTE_WARMUP) !== 'skip'
}
