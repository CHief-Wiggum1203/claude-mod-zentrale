import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Installed, Newer, Setting } from '../types'

const PANE = 'mod-zentrale'
const TITLE = 'Mod-Zentrale'
const SELF = 'mod-zentrale'

// Change a tag when its type's fields change: it declines what an earlier
// version stored, which outlives a reload.
const installed = atom({ plugin: 'mod-zentrale', key: 'installed' } as const, [], { shape: 'installed-1' })
const busy = atom({ plugin: 'mod-zentrale', key: 'busy' } as const, null)
const error = atom({ plugin: 'mod-zentrale', key: 'error' } as const, null)
const switched = atom({ plugin: 'mod-zentrale', key: 'switched' } as const, [])
const newer = atom({ plugin: 'mod-zentrale', key: 'newer' } as const, [], { shape: 'newer-1' })
const isChecking = atom({ plugin: 'mod-zentrale', key: 'isChecking' } as const, false)
const updated = atom({ plugin: 'mod-zentrale', key: 'updated' } as const, [])
const settings = atom({ plugin: 'mod-zentrale', key: 'settings' } as const, [], { shape: 'settings-1' })
const openSettings = atom({ plugin: 'mod-zentrale', key: 'openSettings' } as const, [])

const firstLine = (text: string) => text.trim().split('\n')[0] || 'unbekannter Fehler'

/** Runs the Claude Code this session runs, so the list matches what loads here. */
async function cli($: EngineInterface, args: string[], timeoutMs = 30_000) {
  const binary = (await $.env.get('CLAUDE_CODE_EXECPATH')) ?? 'claude'
  try {
    const ran = await $.process.run([binary, 'plugin', ...args], { timeoutMs })
    return { isOk: ran.exitCode === 0, out: ran.exitCode === 0 ? ran.stdout : ran.stderr || ran.stdout }
  } catch (cause) {
    return { isOk: false, out: String(cause) }
  }
}

async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await $.fs.read(path)) as Record<string, unknown>
  } catch {
    // Missing or not JSON.
    return undefined
  }
}

/** What a plugin's own folder says about it: its description, and whether it is a mod. */
async function folderFacts($: EngineInterface, path: string) {
  const manifest = await readJson($, `${path}/.claude-plugin/plugin.json`)
  const hooks = await readJson($, `${path}/hooks/hooks.json`)
  return {
    description: typeof manifest?.description === 'string' ? manifest.description : '',
    isMod: Array.isArray(hooks?.modules) && hooks.modules.length > 0,
  }
}

/** Whether version `a` is later than `b`; false where either is not dotted numbers. */
function isLater(a: string, b: string) {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : undefined)
  const x = parse(a)
  const y = parse(b)
  if (x === undefined || y === undefined) return false
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

async function loadSettings($: EngineInterface) {
  const rows = await $.config.list()
  const list: Setting[] = rows
    .filter(row => row.provider.plugin !== 'engine' && row.key.startsWith(`${row.provider.plugin}.`))
    .map(row => ({
      key: row.key,
      plugin: row.provider.plugin,
      label: row.label,
      description: row.description ?? '',
      kind: row.kind,
      value: String(row.value),
      options: [...(row.options ?? [])],
      isLocked: row.isLocked,
    }))
  await update($, settings, () => list)
}

async function refresh($: EngineInterface) {
  const listed = await cli($, ['list', '--json'])
  if (!listed.isOk) {
    await update($, error, () => `Liste nicht lesbar: ${firstLine(listed.out)}`)
    return
  }
  let rows: Record<string, unknown>[] = []
  try {
    rows = JSON.parse(listed.out) as Record<string, unknown>[]
  } catch {
    await update($, error, () => 'Liste nicht lesbar: keine gültige Antwort')
    return
  }
  const list: Installed[] = []
  for (const row of rows) {
    const id = String(row.id ?? '')
    const [name = id, marketplace = ''] = id.split('@')
    const facts = typeof row.installPath === 'string' ? await folderFacts($, row.installPath) : { description: '', isMod: false }
    list.push({
      id,
      name,
      marketplace,
      version: String(row.version ?? ''),
      scope: String(row.scope ?? 'user'),
      isEnabled: row.enabled === true,
      ...facts,
    })
  }
  // Mods first, then the other plugins, each by name.
  list.sort((a, b) => Number(b.isMod) - Number(a.isMod) || a.name.localeCompare(b.name))
  await update($, installed, () => list)
  // An installed version may have caught up with what was on offer.
  await update($, newer, offered => offered.filter(n => list.some(p => p.id === n.id && isLater(n.version, p.version))))
  await loadSettings($)
}

/**
 * Fetches every marketplace afresh and reads the version each offers for an
 * installed plugin: the version its entry names, else the one in the plugin's
 * own manifest where the entry is a folder of the marketplace. A plugin the
 * marketplace fetches from elsewhere names no version until installed.
 */
async function checkUpdates($: EngineInterface) {
  if (await read($, isChecking)) return
  await update($, isChecking, () => true)
  const fetched = await cli($, ['marketplace', 'update'], 120_000)
  const places = await cli($, ['marketplace', 'list', '--json'])
  if (!fetched.isOk || !places.isOk) {
    await update($, error, () => `Update-Suche ging nicht: ${firstLine(fetched.isOk ? places.out : fetched.out)}`)
    await update($, isChecking, () => false)
    return
  }
  let markets: Record<string, unknown>[] = []
  try {
    markets = JSON.parse(places.out) as Record<string, unknown>[]
  } catch {
    markets = []
  }
  const found: Newer[] = []
  for (const plugin of await read($, installed)) {
    const market = markets.find(m => m.name === plugin.marketplace)
    if (typeof market?.installLocation !== 'string') continue
    const catalog = await readJson($, `${market.installLocation}/.claude-plugin/marketplace.json`)
    const entries = Array.isArray(catalog?.plugins) ? (catalog.plugins as Record<string, unknown>[]) : []
    const entry = entries.find(e => e.name === plugin.name)
    if (entry === undefined) continue
    let version = typeof entry.version === 'string' ? entry.version : ''
    if (version === '' && typeof entry.source === 'string') {
      const folder = `${market.installLocation}/${entry.source.replace(/^\.\/?/, '')}`.replace(/\/$/, '')
      const manifest = await readJson($, `${folder}/.claude-plugin/plugin.json`)
      version = typeof manifest?.version === 'string' ? manifest.version : ''
    }
    if (isLater(version, plugin.version)) found.push({ id: plugin.id, version })
  }
  await update($, newer, () => found)
  await update($, isChecking, () => false)
}

async function updateOne($: EngineInterface, plugin: Installed) {
  const done = await cli($, ['update', plugin.id, '--scope', plugin.scope], 120_000)
  if (!done.isOk) {
    await update($, error, () => `${plugin.name}: ${firstLine(done.out)}`)
    return false
  }
  await update($, updated, ids => (ids.includes(plugin.id) ? ids : [...ids, plugin.id]))
  return true
}

async function updatePlugins($: EngineInterface, ids: string[]) {
  if ((await read($, busy)) !== null) return
  await update($, error, () => null)
  const list = await read($, installed)
  let count = 0
  for (const id of ids) {
    const plugin = list.find(p => p.id === id)
    if (plugin === undefined) continue
    await update($, busy, () => id)
    if (await updateOne($, plugin)) count++
  }
  await refresh($)
  await update($, busy, () => null)
  if (count > 0) $.ui.toast(count === 1 ? '1 Plugin aktualisiert' : `${count} Plugins aktualisiert`)
}

async function reload($: EngineInterface) {
  await update($, error, () => null)
  await refresh($)
}

async function toggle($: EngineInterface, plugin: Installed) {
  if ((await read($, busy)) !== null) return
  await update($, busy, () => plugin.id)
  await update($, error, () => null)
  const done = await cli($, [plugin.isEnabled ? 'disable' : 'enable', plugin.id, '--scope', plugin.scope])
  if (done.isOk) {
    await update($, switched, ids => (ids.includes(plugin.id) ? ids.filter(id => id !== plugin.id) : [...ids, plugin.id]))
    $.ui.toast(`${plugin.name} ${plugin.isEnabled ? 'ausgeschaltet' : 'eingeschaltet'}`)
  } else {
    await update($, error, () => `${plugin.name}: ${firstLine(done.out)}`)
  }
  await refresh($)
  await update($, busy, () => null)
}

/** Writes one setting as the `/config` menu would; the plugin reloads with it. */
async function setSetting($: EngineInterface, setting: Setting, raw: string) {
  await update($, error, () => null)
  let value: boolean | number | string = raw
  if (setting.kind === 'boolean') value = raw === 'true'
  if (setting.kind === 'number') {
    value = Number(raw.trim().replace(',', '.'))
    if (raw.trim() === '' || !Number.isFinite(value)) {
      await update($, error, () => `${setting.label}: „${raw}“ ist keine Zahl`)
      return
    }
  }
  const done = await $.config.set({ key: setting.key, value })
  if (done.deny !== undefined) {
    await update($, error, () => `${setting.label}: ${done.deny}`)
  } else {
    $.ui.toast(`${setting.label}: ${setting.kind === 'boolean' ? (value === true ? 'an' : 'aus') : String(value)}`)
  }
  await loadSettings($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mods',
      description: 'Öffnet die Mod-Zentrale: Mods ein- und ausschalten, aktualisieren und einstellen',
    })
    await update($, switched, () => [])
    await update($, updated, () => [])
    // A search cut off by a reload never finished.
    await update($, isChecking, () => false)
    // On the desktop app a small widget with the overview; /mods opens it full.
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE, placement: 'widget' })
    void checkUpdates($)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    // The marketplaces take a moment: the pane shows the list meanwhile.
    void checkUpdates($)

    return { text: 'Mod-Zentrale geöffnet.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const list = await read($, installed)
    const working = await read($, busy)
    const problem = await read($, error)
    const changed = await read($, switched)
    const offered = await read($, newer)
    const checking = await read($, isChecking)
    const done = await read($, updated)
    const fields = await read($, settings)
    const opened = await read($, openSettings)

    const settingRow = (setting: Setting) => (
      <Box key={setting.key} flexDirection="column" paddingLeft={4}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text wrap="truncate-end">{setting.label}</Text>
          {setting.isLocked && <Text dimColor>{setting.value} (gesperrt)</Text>}
          {!setting.isLocked && setting.kind === 'boolean' && (
            <Button
              key={`cfg-${setting.key}`}
              label={setting.value === 'true' ? 'An' : 'Aus'}
              variant={setting.value === 'true' ? 'primary' : 'secondary'}
              onPress={() => setSetting($, setting, setting.value === 'true' ? 'false' : 'true')}
            />
          )}
          {!setting.isLocked &&
            setting.kind === 'choice' &&
            setting.options.map(option => (
              <Button
                key={`cfg-${setting.key}-${option}`}
                label={option}
                variant={setting.value === option ? 'primary' : 'secondary'}
                onPress={() => setSetting($, setting, option)}
              />
            ))}
        </Box>
        {!setting.isLocked && (setting.kind === 'number' || setting.kind === 'text') && (
          <Input
            key={`cfg-${setting.key}`}
            value={setting.value}
            placeholder={setting.kind === 'number' ? 'Zahl' : 'Text'}
            submitLabel="Setzen"
            onSubmit={value => setSetting($, setting, value)}
          />
        )}
        {setting.description !== '' && (
          <Text dimColor wrap="truncate-end">
            {setting.description}
          </Text>
        )}
      </Box>
    )

    const row = (plugin: Installed) => {
      const isSelf = plugin.name === SELF
      const offer = offered.find(n => n.id === plugin.id)
      const own = fields.filter(f => f.plugin === plugin.name)
      const isOpen = opened.includes(plugin.id)

      return (
        <Box key={plugin.id} flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color={plugin.isEnabled ? 'success' : 'inactive'}>{plugin.isEnabled ? '●' : '○'}</Text>
            <Text bold wrap="truncate-end">
              {plugin.name}
              <Text dimColor>
                {' '}
                {plugin.version} · {plugin.marketplace}
              </Text>
            </Text>
            {!isSelf && (
              <Button
                key={`toggle-${plugin.id}`}
                label={working === plugin.id ? '…' : plugin.isEnabled ? 'Ausschalten' : 'Einschalten'}
                variant={plugin.isEnabled ? 'secondary' : 'primary'}
                onPress={() => toggle($, plugin)}
              />
            )}
          </Box>
          {plugin.description !== '' && (
            <Text dimColor wrap="truncate-end">
              {'  '}
              {plugin.description}
            </Text>
          )}
          {offer !== undefined && (
            <Box flexDirection="row" alignItems="center" gap={1} paddingLeft={2}>
              <Text color="claude">↑ {offer.version} verfügbar</Text>
              <Button
                key={`update-${plugin.id}`}
                label={working === plugin.id ? '…' : 'Aktualisieren'}
                variant="primary"
                onPress={() => updatePlugins($, [plugin.id])}
              />
            </Box>
          )}
          {own.length > 0 && (
            <Box paddingLeft={2}>
              <Button
                key={`settings-${plugin.id}`}
                label={`Einstellungen (${own.length}) ${isOpen ? '▾' : '▸'}`}
                variant="secondary"
                onPress={() =>
                  update($, openSettings, ids => (ids.includes(plugin.id) ? ids.filter(id => id !== plugin.id) : [...ids, plugin.id]))
                }
              />
            </Box>
          )}
          {isOpen && own.map(settingRow)}
          {changed.includes(plugin.id) && (
            <Text color="warning" wrap="truncate-end">
              {'  '}gilt ab der nächsten Session
            </Text>
          )}
          {done.includes(plugin.id) && (
            <Text color="warning" wrap="truncate-end">
              {'  '}aktualisiert · gilt ab der nächsten Session
            </Text>
          )}
        </Box>
      )
    }

    const mods = list.filter(p => p.isMod)
    const others = list.filter(p => !p.isMod)
    const enabledIn = (group: Installed[]) => group.filter(p => p.isEnabled).length

    // The widget: the overview at a glance, nothing to click.
    if (e.props.placement === 'widget') {
      const pending = new Set([...changed, ...done]).size

      return (
        <Box flexDirection="column">
          {list.length === 0 && problem === null && <Text dimColor>Liste wird geladen …</Text>}
          {list.length > 0 && (
            <Text wrap="truncate-end">
              <Text bold>Mods</Text>
              <Text dimColor>
                {' '}
                {enabledIn(mods)}/{mods.length} an ·{' '}
              </Text>
              <Text bold>Plugins</Text>
              <Text dimColor>
                {' '}
                {enabledIn(others)}/{others.length} an
              </Text>
            </Text>
          )}
          {offered.length > 0 && (
            <Text color="claude" wrap="truncate-end">
              ↑ {offered.length === 1 ? '1 Update verfügbar' : `${offered.length} Updates verfügbar`}
            </Text>
          )}
          {offered.length === 0 && checking && <Text dimColor>Suche Updates …</Text>}
          {pending > 0 && (
            <Text color="warning" wrap="truncate-end">
              {pending === 1 ? '1 Änderung gilt' : `${pending} Änderungen gelten`} ab der nächsten Session
            </Text>
          )}
          {problem !== null && (
            <Text color="error" wrap="truncate-end">
              {problem}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor wrap="truncate-end">
            {list.filter(p => p.isEnabled).length} von {list.length} eingeschaltet
          </Text>
          <Button key="refresh" label="Liste neu laden" variant="secondary" onPress={() => reload($)} />
          <Button
            key="check-updates"
            label={checking ? 'Suche Updates …' : 'Nach Updates suchen'}
            variant="secondary"
            onPress={() => checkUpdates($)}
          />
        </Box>
        {offered.length > 0 && (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text color="claude">
              {offered.length === 1 ? '1 Update verfügbar' : `${offered.length} Updates verfügbar`}
            </Text>
            {offered.length > 1 && (
              <Button
                key="update-all"
                label="Alle aktualisieren"
                variant="primary"
                onPress={() =>
                  updatePlugins(
                    $,
                    offered.map(n => n.id),
                  )
                }
              />
            )}
          </Box>
        )}
        {problem !== null && (
          <Text color="error" wrap="truncate-end">
            {problem}
          </Text>
        )}
        {list.length === 0 && <Text dimColor>Noch keine Liste: „Liste neu laden“ drücken.</Text>}
        {mods.length > 0 && <Text bold>Mods</Text>}
        {mods.map(row)}
        {others.length > 0 && <Text bold>Weitere Plugins</Text>}
        {others.map(row)}
      </Box>
    )
  })
}
