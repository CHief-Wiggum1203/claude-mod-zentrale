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

/** A newer version a plugin's marketplace offers than the one installed. */
export type Newer = { id: string; version: string }

/** One of a plugin's `userConfig` fields, as the `/config` menu holds it now. */
export type Setting = {
  /** `<plugin>.<field>`, what `$.config.set` takes. */
  key: string
  /** The plugin's manifest name. */
  plugin: string
  label: string
  description: string
  kind: 'boolean' | 'choice' | 'text' | 'number'
  /** The value as text: `true` / `false` for a boolean. */
  value: string
  options: string[]
  isLocked: boolean
}

/** The advisor as the user settings hold it: the model while on, `null` while off. */
export type Advisor = { model: string | null }

declare module 'claude-code' {
  interface PluginState {
    'mod-zentrale': {
      installed: Shaped<Installed[]>
      /** The id being switched or updated right now. */
      busy: string | null
      /** The last thing that went wrong, shown until the next action. */
      error: string | null
      /** Ids switched in this session: they take effect in the next one. */
      switched: string[]
      /** The plugins with a newer version on offer, from the last look. */
      newer: Shaped<Newer[]>
      /** Whether the marketplaces are being asked for newer versions now. */
      isChecking: boolean
      /** Ids updated in this session: they take effect in the next one. */
      updated: string[]
      /** The settings of the loaded plugins that have any. */
      settings: Shaped<Setting[]>
      /** The plugins whose settings are opened in the pane. */
      openSettings: string[]
      /** The advisor's state; `null` when the user settings could not be read. */
      advisor: Advisor | null
    }
  }
}
