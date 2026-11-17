import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Installed } from '../types'

const PANE = 'mod-zentrale'
const TITLE = 'Mod-Zentrale'
const SELF = 'mod-zentrale'

// Change the tag when Installed's fields change: it declines what an earlier
// version stored, which outlives a reload.
const installed = atom({ plugin: 'mod-zentrale', key: 'installed' } as const, [], { shape: 'installed-1' })
const busy = atom({ plugin: 'mod-zentrale', key: 'busy' } as const, null)
const error = atom({ plugin: 'mod-zentrale', key: 'error' } as const, null)
const switched = atom({ plugin: 'mod-zentrale', key: 'switched' } as const, [])

/** Runs the Claude Code this session runs, so the list matches what loads here. */
async function cli($: EngineInterface, args: string[]) {
  const binary = (await $.env.get('CLAUDE_CODE_EXECPATH')) ?? 'claude'
  try {
    const ran = await $.process.run([binary, 'plugin', ...args], { timeoutMs: 30_000 })
    return { isOk: ran.exitCode === 0, out: ran.exitCode === 0 ? ran.stdout : ran.stderr || ran.stdout }
  } catch (cause) {
    return { isOk: false, out: String(cause) }
  }
}

/** What a plugin's own folder says about it: its description, and whether it is a mod. */
async function folderFacts($: EngineInterface, path: string) {
  let description = ''
  let isMod = false
  try {
    const manifest = JSON.parse(await $.fs.read(`${path}/.claude-plugin/plugin.json`)) as { description?: unknown }
    if (typeof manifest.description === 'string') description = manifest.description
  } catch {
    // No manifest, or not JSON: the row goes without a description.
  }
  try {
    const hooks = JSON.parse(await $.fs.read(`${path}/hooks/hooks.json`)) as { modules?: unknown }
    isMod = Array.isArray(hooks.modules) && hooks.modules.length > 0
  } catch {
    // No hooks file: skills, commands or tools only.
  }
  return { description, isMod }
}

async function refresh($: EngineInterface) {
  const listed = await cli($, ['list', '--json'])
  if (!listed.isOk) {
    await update($, error, () => `Liste nicht lesbar: ${listed.out.trim().split('\n')[0] ?? ''}`)
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
    await update($, error, () => `${plugin.name}: ${done.out.trim().split('\n')[0] ?? 'unbekannter Fehler'}`)
  }
  await refresh($)
  await update($, busy, () => null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Öffnet die Mod-Zentrale: installierte Mods ein- und ausschalten' })
    await update($, switched, () => [])

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Mod-Zentrale geöffnet.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, installed)
    const working = await read($, busy)
    const problem = await read($, error)
    const changed = await read($, switched)

    const row = (plugin: Installed) => {
      const isSelf = plugin.name === SELF

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
          {changed.includes(plugin.id) && (
            <Text color="warning" wrap="truncate-end">
              {'  '}gilt ab der nächsten Session
            </Text>
          )}
        </Box>
      )
    }

    const mods = list.filter(p => p.isMod)
    const others = list.filter(p => !p.isMod)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor wrap="truncate-end">
            {list.filter(p => p.isEnabled).length} von {list.length} eingeschaltet
          </Text>
          <Button key="refresh" label="Aktualisieren" variant="secondary" onPress={() => reload($)} />
        </Box>
        {problem !== null && (
          <Text color="error" wrap="truncate-end">
            {problem}
          </Text>
        )}
        {list.length === 0 && <Text dimColor>Noch keine Liste: „Aktualisieren“ drücken.</Text>}
        {mods.length > 0 && <Text bold>Mods</Text>}
        {mods.map(row)}
        {others.length > 0 && <Text bold>Weitere Plugins</Text>}
        {others.map(row)}
      </Box>
    )
  })
}
