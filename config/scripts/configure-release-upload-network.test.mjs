import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { runProcess } from '@orca/process-host'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'config/scripts/configure-release-upload-network.sh')
const bash =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
    : 'bash'

// Every network and privileged command is a shell function: these tests never change the host.
const harness = `
uname() { printf '%s\n' "\${MOCK_OS:-Linux}"; }
sudo() {
  printf 'sudo %s\n' "$*" >&2
  [[ "$1" == -n ]] || return 90
  shift
  "$@"
}
modprobe() {
  [[ "$MOCK_CASE" != "module-$1-fails" ]]
}
ip() {
  [[ "$*" == '-4 route show default' ]] || return 90
  case "$MOCK_CASE" in
    route-fails) return 1;;
    no-route) return 0;;
    ambiguous-route) printf 'default via 1.2.3.4 dev eth0\ndefault via 1.2.3.5 dev eth1\n';;
    bad-interface) printf 'default via 1.2.3.4 dev eth0;bad\n';;
    *) printf 'default via 1.2.3.4 dev eth0 proto dhcp\n';;
  esac
}
tc() {
  case "$*" in
    'qdisc replace dev eth0 root fq') [[ "$MOCK_CASE" != qdisc-replace-fails ]];;
    'qdisc show dev eth0')
      [[ "$MOCK_CASE" != qdisc-read-fails ]] || return 1
      if [[ "$MOCK_CASE" == wrong-qdisc ]]; then
        printf 'qdisc fq_codel 0: root refcnt 2\n'
      else
        printf 'qdisc fq 8001: root refcnt 2 limit 10000p\n'
      fi;;
    *) return 90;;
  esac
}
sysctl() {
  case "$*" in
    '-n net.ipv4.tcp_available_congestion_control')
      [[ "$MOCK_CASE" != available-read-fails ]] || return 1
      if [[ "$MOCK_CASE" == no-bbr ]]; then printf 'reno cubic bbr2\n'; else printf 'reno cubic bbr\n'; fi;;
    '-w net.ipv4.tcp_congestion_control=bbr') [[ "$MOCK_CASE" != sysctl-write-fails ]];;
    '-n net.ipv4.tcp_congestion_control')
      [[ "$MOCK_CASE" != selected-read-fails ]] || return 1
      if [[ "$MOCK_CASE" == wrong-controller ]]; then printf 'cubic\n'; else printf 'bbr\n'; fi;;
    *) return 90;;
  esac
}
source "$1"
`

function run(scenario = 'success', overrides = {}) {
  return runProcess({
    program: bash,
    args: ['--noprofile', '--norc', '-c', harness, 'test-upload-network', script],
    env: {
      ...process.env,
      GITHUB_ACTIONS: 'true',
      RUNNER_ENVIRONMENT: 'github-hosted',
      MOCK_CASE: scenario,
      MOCK_OS: 'Linux',
      ORCA_BACKGROUND_LAUNCH: '1',
      ...overrides
    }
  })
}

it.each([
  { GITHUB_ACTIONS: '' },
  { GITHUB_ACTIONS: 'false' },
  { RUNNER_ENVIRONMENT: 'self-hosted' },
  { RUNNER_ENVIRONMENT: '' },
  { MOCK_OS: 'Darwin' }
])('rejects non-hosted Linux contexts before any privileged command: %j', async (environment) => {
  const result = await run('success', environment)
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('requires a GitHub-hosted Linux runner')
  expect(result.stderr).not.toContain('sudo ')
})

it.each(['success', 'module-tcp_bbr-fails'])(
  'verifies fq and bbr, including already available BBR after module load failure: %s',
  async (scenario) => {
    const result = await run(scenario)
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('interface=eth0, root qdisc=fq, congestion control=bbr')
    expect(result.stderr.match(/^sudo .+$/gm)).toEqual([
      'sudo -n modprobe tcp_bbr',
      'sudo -n modprobe sch_fq',
      'sudo -n tc qdisc replace dev eth0 root fq',
      'sudo -n sysctl -w net.ipv4.tcp_congestion_control=bbr'
    ])
  }
)

it.each([
  'no-bbr',
  'available-read-fails',
  'route-fails',
  'no-route',
  'ambiguous-route',
  'bad-interface',
  'module-sch_fq-fails',
  'qdisc-replace-fails',
  'qdisc-read-fails',
  'wrong-qdisc',
  'sysctl-write-fails',
  'selected-read-fails',
  'wrong-controller'
])('fails closed when sender configuration or readback fails: %s', async (scenario) => {
  const result = await run(scenario)
  expect(result.code).not.toBe(0)
  expect(result.stdout).not.toContain('Release upload sender verified')
  if (['no-bbr', 'available-read-fails'].includes(scenario)) {
    expect(result.stderr).not.toContain('sudo -n modprobe sch_fq')
  }
  if (['wrong-qdisc', 'qdisc-read-fails', 'qdisc-replace-fails'].includes(scenario)) {
    expect(result.stderr).not.toContain('sudo -n sysctl -w')
  }
})

it('runs the same sender setup before both public uploads and in the existing hosted PR package job', () => {
  const workflows = [
    ['mobile-android-release.yml', 'android-build', 'Publish signed APK to HiveCloud'],
    [
      'hivecode-linux-release.yml',
      'publish',
      'Publish AppImages and Runtime debs to HiveCloud object storage'
    ],
    ['pr.yml', 'package', 'Cache electron-builder downloads']
  ]
  for (const [name, jobName, nextStep] of workflows) {
    const workflow = parse(readFileSync(join(root, '.github/workflows', name), 'utf8'))
    const job = workflow.jobs[jobName]
    expect(job['runs-on']).toBe('ubuntu-latest')
    const index = job.steps.findIndex((step) => step.name === 'Configure release upload sender')
    expect(index).toBeGreaterThan(
      job.steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'))
    )
    expect(job.steps[index + 1].name).toBe(nextStep)
    expect(job.steps[index]).toMatchObject({
      shell: 'bash',
      run: 'bash config/scripts/configure-release-upload-network.sh'
    })
    expect(job.steps[index]['continue-on-error']).toBeUndefined()
    if (name === 'mobile-android-release.yml') {
      expect(job.steps[index].if).toBe("inputs.batch_id != ''")
      expect(job.steps[index].if).toBe(job.steps[index + 1].if)
      expect(job.steps[index]['working-directory']).toBe('.')
      expect(job['timeout-minutes']).toBeUndefined()
    } else if (name === 'hivecode-linux-release.yml') {
      expect(job.if).toContain("inputs.batch_id != ''")
      expect(job['timeout-minutes']).toBe(360)
    } else {
      expect(job.steps[index].if).toBeUndefined()
      expect(job['timeout-minutes']).toBe(90)
    }
  }
})
