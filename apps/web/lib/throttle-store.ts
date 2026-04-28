export interface ThrottleState {
  hits: number[]
  lockoutLevel: number
  lockedUntil: number
}

export interface ThrottleStore {
  transact<T>(
    scope: string,
    key: string,
    apply: (state: ThrottleState) => Promise<{ result: T; state: ThrottleState }> | { result: T; state: ThrottleState },
  ): Promise<T>
  clear(scope: string, key: string): Promise<void>
}

const EMPTY_STATE: ThrottleState = {
  hits: [],
  lockoutLevel: 0,
  lockedUntil: 0,
}

function cloneState(state: ThrottleState): ThrottleState {
  return {
    hits: [...state.hits],
    lockoutLevel: state.lockoutLevel,
    lockedUntil: state.lockedUntil,
  }
}

export function createInMemoryThrottleStore(): ThrottleStore {
  const state = new Map<string, ThrottleState>()

  return {
    async transact(scope, key, apply) {
      const mapKey = `${scope}:${key}`
      const current = cloneState(state.get(mapKey) ?? EMPTY_STATE)
      const outcome = await apply(current)
      state.set(mapKey, cloneState(outcome.state))
      return outcome.result
    },
    async clear(scope, key) {
      state.delete(`${scope}:${key}`)
    },
  }
}
