import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

type Fake = { id: string; enabled: boolean; scope?: string; description?: string; isMod?: boolean }

/** A Claude Code CLI holding these plugins, switching them as asked; returns the commands it ran. */
function fakeCli(on: On, plugins: Fake[], opts: { failEnable?: boolean } = {}) {
  const ran: string[] = []
  const toasts: string[] = []
  on('env.get', () => ({ value: '/app/claude' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const plugin = plugins.find(p => e.path.startsWith(`/cache/${p.id}/`))
    if (plugin !== undefined && e.path.endsWith('plugin.json') && plugin.description !== undefined)
      return { value: JSON.stringify({ name: plugin.id.split('@')[0], description: plugin.description }) }
    if (plugin !== undefined && e.path.endsWith('hooks.json') && plugin.isMod === true)
      return { value: JSON.stringify({ modules: ['./register.tsx'] }) }
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => {
    const args = e.argv.slice(2)
    ran.push(args.join(' '))
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (args[0] === 'list') {
      return ok(
        JSON.stringify(
          plugins.map(p => ({ id: p.id, version: '1.0.0', scope: p.scope ?? 'user', enabled: p.enabled, installPath: `/cache/${p.id}/1.0.0` })),
        ),
      )
    }
    const plugin = plugins.find(p => p.id === args[1])
    if (args[0] === 'enable' && opts.failEnable === true) {
      return { value: { exitCode: 1, stdout: '', stderr: 'Plugin is blocked by policy\n', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (plugin !== undefined && (args[0] === 'enable' || args[0] === 'disable')) {
      plugin.enabled = args[0] === 'enable'
      return ok('')
    }
    return { value: { exitCode: 1, stdout: '', stderr: `unexpected ${args.join(' ')}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { ran, toasts }
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
  expect(cli.ran).toEqual(['list --json'])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /eingeschaltet$/ }))?.text).toBe('3 von 4 eingeschaltet')
  await ui.unmount()
})
