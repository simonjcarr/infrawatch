interface TerminalBindingWithPassword {
  password?: string
}

interface TerminalTabWithBinding<TBinding extends TerminalBindingWithPassword = TerminalBindingWithPassword> {
  id: string
  binding: TBinding
}

export function clearTerminalPasswordForTab<TTab extends TerminalTabWithBinding>(
  tabs: readonly TTab[],
  tabId: string,
): TTab[] {
  return tabs.map((tab) => {
    if (tab.id !== tabId || tab.binding.password === undefined) return tab
    return {
      ...tab,
      binding: {
        ...tab.binding,
        password: undefined,
      },
    }
  })
}
