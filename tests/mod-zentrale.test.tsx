import { expect, test } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'

const PANE = {
  plugin: 'mod-zentrale',
  component: 'Pane',
  requestId: 'mod-zentrale',
  props: {
    title: 'Mod-Zentrale',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Fake = {
  id: string
  enabled: boolean
  scope?: string
  description?: string
  isMod?: boolean
  version?: string
  /** A claude.ai copy that a plugin of the same name on this machine shadows. */
  isShadowed?: boolean
  /** What its marketplace offers, named in the catalog entry or in the plugin's manifest there. */
  offered?: { version: string; in: 'entry' | 'manifest' }
}

/** A Claude Code CLI holding these plugins, switching them as asked; returns the commands it ran. */
function fakeCli(on: On, plugins: Fake[], opts: { failEnable?: boolean; config?: ConfigRow[]; denyConfig?: string; settings?: Record<string, unknown>; failMarketUpdate?: string } = {}) {
  const ran: string[] = []
  const toasts: string[] = []
  on('env.get', () => ({ value: '/app/claude' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const config = opts.config ?? []
  const writes: string[] = []
  on('config.list', () => ({ value: config }))
  on('config.set', (_, e) => {
    if (opts.denyConfig !== undefined) return { deny: opts.denyConfig }
    writes.push(`${e.key}=${String(e.value)}`)
    const index = config.findIndex(row => row.key === e.key)
    const row = config[index]
    if (row !== undefined) config[index] = { ...row, value: e.value }
    return { value: e.value }
  })
  const market = (p: Fake) => p.id.split('@')[1] ?? ''
  on('fs.read', (_, raw) => {
    const e = { path: raw.path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '') }
    if (e.path === '/app/claude/settings.json' && opts.settings !== undefined) return { value: `${JSON.stringify(opts.settings, null, 2)}\n` }
    const catalog = /^\/mk\/([^/]+)\/\.claude-plugin\/marketplace\.json$/.exec(e.path)
    if (catalog !== null) {
      const entries = plugins
        .filter(p => market(p) === catalog[1] && p.offered !== undefined)
        .map(p => (p.offered?.in === 'entry' ? { name: p.id.split('@')[0], version: p.offered.version, source: { source: 'url' } } : { name: p.id.split('@')[0], source: './' }))
      return { value: JSON.stringify({ name: catalog[1], plugins: entries }) }
    }
    const shipped = /^\/mk\/([^/]+)\/\.claude-plugin\/plugin\.json$/.exec(e.path)
    const offeredHere = plugins.find(p => shipped !== null && market(p) === shipped[1] && p.offered?.in === 'manifest')
    if (offeredHere !== undefined) return { value: JSON.stringify({ name: offeredHere.id.split('@')[0], version: offeredHere.offered?.version }) }
    const plugin = plugins.find(p => e.path.startsWith(`/cache/${p.id}/`))
    if (plugin !== undefined && e.path.endsWith('plugin.json') && plugin.description !== undefined)
      return { value: JSON.stringify({ name: plugin.id.split('@')[0], description: plugin.description }) }
    if (plugin !== undefined && e.path.endsWith('hooks.json') && plugin.isMod === true)
      return { value: JSON.stringify({ modules: ['./register.tsx'] }) }
    throw new Error('ENOENT')
  })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  const saved: string[] = []
  on('fs.write', (_, e) => {
    saved.push(e.text)
    if (opts.settings !== undefined) opts.settings = JSON.parse(e.text) as Record<string, unknown>
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const args = e.argv.slice(2)
    ran.push(args.join(' '))
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args[0] === 'list') {
      return ok(
        JSON.stringify(
          plugins.map(p => ({
            id: p.id,
            version: p.version ?? '1.0.0',
            scope: p.scope ?? 'user',
            enabled: p.enabled,
            installPath: `/cache/${p.id}/1.0.0`,
            ...(p.isShadowed === true ? { noteDetails: [{ type: 'synced-plugin-shadowed', related: 'x' }] } : {}),
          })),
        ),
      )
    }
    if (args.join(' ') === 'marketplace update' && opts.failMarketUpdate !== undefined) {
      return { value: { exitCode: 1, stdout: opts.failMarketUpdate, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (args.join(' ') === 'marketplace update') return ok('')
    if (args.join(' ') === 'marketplace list --json') {
      return ok(JSON.stringify([...new Set(plugins.map(market))].map(name => ({ name, installLocation: `/mk/${name}` }))))
    }
    const plugin = plugins.find(p => p.id === args[1])
    if (plugin !== undefined && args[0] === 'update' && plugin.offered !== undefined) {
      plugin.version = plugin.offered.version
      return ok('')
    }
    if (args[0] === 'enable' && opts.failEnable === true) {
      return { value: { exitCode: 1, stdout: '', stderr: 'Plugin is blocked by policy\n', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (plugin !== undefined && (args[0] === 'enable' || args[0] === 'disable')) {
      plugin.enabled = args[0] === 'enable'
      return ok('')
    }
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected ${args.join(' ')}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { ran, toasts, writes, saved }
}

const PLUGINS = (): Fake[] => [
  { id: 'superpowers@claude-plugins-official', enabled: true, description: 'Skills für alles' },
  { id: 'git-pull-guard@claude-git-pull-guard', enabled: true, description: 'Erst pullen', isMod: true },
  { id: 'agent-monitor@claude-agent-monitor', enabled: false, scope: 'project', isMod: true },
  { id: 'mod-zentrale@claude-mod-zentrale', enabled: true, isMod: true },
]

test('the pane lists mods first, then the other plugins, each with its state', async ($, on) => {
  const cli = fakeCli(on, PLUGINS())
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('3 von 4 eingeschaltet')
    const order = texts.filter(t => /^(Mods|Weitere Plugins|agent-monitor|git-pull-guard|mod-zentrale|superpowers) /.test(`${t} `))
    expect(order.map(t => t.split(' ')[0])).toEqual(['Mods', 'agent-monitor', 'git-pull-guard', 'mod-zentrale', 'Weitere', 'superpowers'])
    expect(texts).toContain('  Erst pullen')
    expect((await ui.find({ key: 'toggle-agent-monitor@claude-agent-monitor' }))?.text).toBe('Einschalten')
    expect((await ui.find({ key: 'toggle-git-pull-guard@claude-git-pull-guard' }))?.text).toBe('Ausschalten')
    // The center cannot switch itself off: it would leave no way back.
    expect(await ui.find({ key: 'toggle-mod-zentrale@claude-mod-zentrale' })).toBeUndefined()
    await ui.unmount()
  }
  expect(cli.ran).toEqual(['list --json', 'list --json'])
})

test('a press switches a plugin in its own scope and says when it takes effect', async ($, on) => {
  const cli = fakeCli(on, PLUGINS())
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })

  await ui.press({ key: 'toggle-git-pull-guard@claude-git-pull-guard' })
  await ui.press({ key: 'toggle-agent-monitor@claude-agent-monitor' })
  expect(cli.ran).toContain('disable git-pull-guard@claude-git-pull-guard --scope user')
  expect(cli.ran).toContain('enable agent-monitor@claude-agent-monitor --scope project')
  expect(cli.toasts).toEqual(['git-pull-guard ausgeschaltet', 'agent-monitor eingeschaltet'])
  expect((await ui.find({ key: 'toggle-git-pull-guard@claude-git-pull-guard' }))?.text).toBe('Einschalten')
  expect((await ui.findAll({ type: 'Text', text: /nächsten Session/ })).length).toBe(2)

  // Switching back undoes the note.
  await ui.press({ key: 'toggle-git-pull-guard@claude-git-pull-guard' })
  expect((await ui.findAll({ type: 'Text', text: /nächsten Session/ })).length).toBe(1)
  await ui.unmount()
})

test('a refused switch shows why and leaves the plugin as it was', async ($, on) => {
  fakeCli(on, PLUGINS(), { failEnable: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-agent-monitor@claude-agent-monitor' })
  expect((await ui.find({ type: 'Text', text: /blocked/ }))?.text).toBe('agent-monitor: Plugin is blocked by policy')
  expect((await ui.find({ key: 'toggle-agent-monitor@claude-agent-monitor' }))?.text).toBe('Einschalten')
  await ui.unmount()
})

test('/mods reads the list and opens the pane', async ($, on) => {
  const cli = fakeCli(on, PLUGINS())
  let opened = ''
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    opened = e.title ?? ''
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const answer = await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(answer.text).toBe('Mod-Zentrale geöffnet.')
  expect(opened).toBe('Mod-Zentrale')
  // Once when the session starts, once for /mods.
  expect(cli.ran.filter(c => c === 'list --json')).toEqual(['list --json', 'list --json'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /eingeschaltet$/ }))?.text).toBe('3 von 4 eingeschaltet')
  await ui.unmount()
})

test('newer versions on offer show per plugin, and one press brings them in', async ($, on) => {
  const plugins: Fake[] = [
    { id: 'agent-monitor@claude-agent-monitor', enabled: true, isMod: true, version: '0.4.0', offered: { version: '0.10.0', in: 'manifest' } },
    { id: 'swift-lsp@claude-plugins-official', enabled: true, version: '1.0.0', offered: { version: '1.1.0', in: 'entry' } },
    // Same version, and an older one: nothing to offer.
    { id: 'git-pull-guard@claude-git-pull-guard', enabled: true, isMod: true, version: '0.3.0', offered: { version: '0.3.0', in: 'manifest' } },
    { id: 'superpowers@claude-plugins-official', enabled: true, version: '5.1.0', offered: { version: '5.0.0', in: 'entry' } },
  ]
  const cli = fakeCli(on, plugins)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'check-updates' })
    expect((await ui.find({ type: 'Text', text: /Updates verfügbar/ }))?.text).toBe('2 Updates verfügbar')
    expect((await ui.findAll({ type: 'Text', text: /verfügbar$/ })).map(t => t.text)).toEqual([
      '2 Updates verfügbar',
      '↑ 0.10.0 verfügbar',
      '↑ 1.1.0 verfügbar',
    ])
    expect(await ui.find({ key: 'update-git-pull-guard@claude-git-pull-guard' })).toBeUndefined()
    expect(await ui.find({ key: 'update-superpowers@claude-plugins-official' })).toBeUndefined()
    await ui.unmount()
  }
  expect(cli.ran).toContain('marketplace update')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'update-all' })
  expect(cli.ran).toContain('update agent-monitor@claude-agent-monitor --scope user')
  expect(cli.ran).toContain('update swift-lsp@claude-plugins-official --scope user')
  expect(cli.toasts).toEqual(['2 Plugins aktualisiert'])
  expect(await ui.find({ type: 'Text', text: /Updates? verfügbar/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /agent-monitor/ }))?.text).toBe('agent-monitor 0.10.0 · claude-agent-monitor')
  expect((await ui.findAll({ type: 'Text', text: /aktualisiert · gilt/ })).length).toBe(2)
  await ui.unmount()
})

test('a marketplace that cannot be fetched is named, and the others are still compared', async ($, on) => {
  const plugins: Fake[] = [
    { id: 'agent-monitor@claude-agent-monitor', enabled: true, isMod: true, version: '0.4.0', offered: { version: '0.6.0', in: 'manifest' } },
  ]
  fakeCli(on, plugins, {
    failMarketUpdate: 'Updating marketplaces...✘ Failed to update marketplace claude-plugins-official: could not lock\n✔ Updated 5 of 6 marketplaces\n',
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'check-updates' })
  expect((await ui.find({ type: 'Text', text: /Marketplace/ }))?.text).toBe(
    'Nicht jeder Marketplace ließ sich abfragen: ✘ Failed to update marketplace claude-plugins-official: could not lock',
  )
  expect((await ui.find({ type: 'Text', text: /↑/ }))?.text).toBe('↑ 0.6.0 verfügbar')
  await ui.unmount()
})

const ROW = (key: string, kind: ConfigRow['kind'], value: ConfigRow['value'], extra: Partial<ConfigRow> = {}): ConfigRow => ({
  key,
  label: key.split('.')[1] ?? key,
  kind,
  value,
  provider: { plugin: key.split('.')[0] ?? '', tier: 'user' },
  isLocked: false,
  ...extra,
})

test('a mod with options opens its settings in the pane, and a change is written', async ($, on) => {
  const cli = fakeCli(on, PLUGINS(), {
    config: [
      ROW('git-pull-guard.autoPull', 'boolean', true, { label: 'Automatisch pullen', description: 'Holt neue Commits selbst' }),
      ROW('git-pull-guard.recheckMinutes', 'number', 15, { label: 'Erneut prüfen nach (Minuten)' }),
      ROW('git-pull-guard.ignore', 'text', '', { label: 'Ausgenommene Repos' }),
      ROW('git-pull-guard.mode', 'choice', 'leise', { label: 'Modus', options: ['leise', 'laut'] }),
      ROW('theme', 'choice', 'dark', { provider: { plugin: 'engine', tier: 'core' }, options: ['dark', 'light'] }),
    ],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    // The engine's own rows are /config's, not a plugin's.
    expect((await ui.find({ key: 'settings-git-pull-guard@claude-git-pull-guard' }))?.text).toBe('Einstellungen (4) ▸')
    expect(await ui.find({ key: 'settings-superpowers@claude-plugins-official' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Automatisch pullen/ })).toBeUndefined()
    await ui.press({ key: 'settings-git-pull-guard@claude-git-pull-guard' })
    expect((await ui.find({ type: 'Text', text: /Holt neue/ }))?.text).toBe('Holt neue Commits selbst')
    expect((await ui.find({ key: 'cfg-git-pull-guard.autoPull' }))?.text).toBe('An')
    await ui.press({ key: 'settings-git-pull-guard@claude-git-pull-guard' })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'settings-git-pull-guard@claude-git-pull-guard' })
  await ui.press({ key: 'cfg-git-pull-guard.autoPull' })
  expect((await ui.find({ key: 'cfg-git-pull-guard.autoPull' }))?.text).toBe('Aus')
  await ui.input({ key: 'cfg-git-pull-guard.recheckMinutes', text: '30' })
  await ui.input({ key: 'cfg-git-pull-guard.ignore', text: 'dotfiles' })
  await ui.press({ key: 'cfg-git-pull-guard.mode-laut' })
  expect(cli.writes).toEqual([
    'git-pull-guard.autoPull=false',
    'git-pull-guard.recheckMinutes=30',
    'git-pull-guard.ignore=dotfiles',
    'git-pull-guard.mode=laut',
  ])
  expect(cli.toasts).toEqual(['Automatisch pullen: aus', 'Erneut prüfen nach (Minuten): 30', 'Ausgenommene Repos: dotfiles', 'Modus: laut'])

  // Not a number: nothing is written, and the pane says why.
  await ui.input({ key: 'cfg-git-pull-guard.recheckMinutes', text: 'oft' })
  expect((await ui.find({ type: 'Text', text: /keine Zahl/ }))?.text).toBe('Erneut prüfen nach (Minuten): „oft“ ist keine Zahl')
  expect(cli.writes).toHaveLength(4)
  await ui.unmount()
})

test('a refused setting shows why', async ($, on) => {
  fakeCli(on, PLUGINS(), {
    config: [ROW('git-pull-guard.autoPull', 'boolean', true, { label: 'Automatisch pullen' })],
    denyConfig: 'set by your organization',
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'settings-git-pull-guard@claude-git-pull-guard' })
  await ui.press({ key: 'cfg-git-pull-guard.autoPull' })
  expect((await ui.find({ type: 'Text', text: /organization/ }))?.text).toBe('Automatisch pullen: set by your organization')
  expect((await ui.find({ key: 'cfg-git-pull-guard.autoPull' }))?.text).toBe('An')
  await ui.unmount()
})

test('a session starts it as a widget with the overview, nothing to click', async ($, on) => {
  fakeCli(on, PLUGINS())
  const opens: unknown[] = []
  on('command.register', () => ({ value: { command: 'mods' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opens.length).toBe(1)
  expect(opens[0]).toEqual(expect.objectContaining({ id: 'mod-zentrale', placement: 'widget' }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect((await ui.find({ type: 'Text', text: /^Mods/ }))?.text).toBe('Mods 2/3 an · Plugins 1/1 an')
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a plugin synced from claude.ai switches without a scope the CLI does not know', async ($, on) => {
  const cli = fakeCli(on, [...PLUGINS(), { id: 'legal@synced', enabled: true, scope: 'synced' }])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'toggle-legal@synced' })
  expect(cli.ran).toContain('disable legal@synced')
  expect((await ui.find({ key: 'toggle-legal@synced' }))?.text).toBe('Einschalten')
  await ui.unmount()
})

test('a synced copy shadowed by a plugin of the same name on this machine is left out', async ($, on) => {
  fakeCli(on, [...PLUGINS(), { id: 'superpowers@synced', enabled: true, scope: 'synced', version: 'unknown', isShadowed: true }])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'toggle-superpowers@synced' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle-superpowers@claude-plugins-official' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /eingeschaltet$/ }))?.text).toBe('3 von 4 eingeschaltet')
  await ui.unmount()
})

test('the advisor switch takes advisorModel out of the user settings and brings it back', async ($, on) => {
  const settings = { theme: 'dark', advisorModel: 'fable', tui: 'fullscreen' }
  const cli = fakeCli(on, PLUGINS(), { settings })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Text', text: /^Advisor/ }))?.text).toBe('Advisor fable')
  expect((await ui.find({ key: 'advisor' }))?.text).toBe('Ausschalten')

  await ui.press({ key: 'advisor' })
  expect(JSON.parse(cli.saved[0] ?? '{}')).toEqual({ theme: 'dark', tui: 'fullscreen' })
  expect(cli.saved[0]?.endsWith('}\n')).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^Advisor/ }))?.text).toBe('Advisor aus')
  expect((await ui.find({ key: 'advisor' }))?.text).toBe('Einschalten')

  await ui.press({ key: 'advisor' })
  expect(JSON.parse(cli.saved[1] ?? '{}')).toEqual({ theme: 'dark', tui: 'fullscreen', advisorModel: 'fable' })
  expect((await ui.find({ type: 'Text', text: /^Advisor/ }))?.text).toBe('Advisor fable')
  expect(cli.toasts).toEqual(['Advisor aus', 'Advisor an: fable'])
  await ui.unmount()

  const widget = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, placement: 'widget' } })
  expect((await widget.find({ type: 'Text', text: /^Advisor/ }))?.text).toBe('Advisor fable')
  await widget.unmount()
})

test('without readable user settings there is no advisor switch', async ($, on) => {
  fakeCli(on, PLUGINS())
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'advisor' })).toBeUndefined()
  await ui.unmount()
})
