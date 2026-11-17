/** One installed plugin, as `claude plugin list --json` reports it, with what its folder says. */
export type Installed = {
  /** `<name>@<marketplace>`. */
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  isEnabled: boolean
  /** From its plugin.json, empty when it has none. */
  description: string
  /** Whether it brings a hooks module: a mod, not only skills or tools. */
  isMod: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'mod-zentrale': {
      installed: Shaped<Installed[]>
      /** The id being switched right now. */
      busy: string | null
      /** The last thing that went wrong, shown until the next action. */
      error: string | null
      /** Ids switched in this session: they take effect in the next one. */
      switched: string[]
    }
  }
}
