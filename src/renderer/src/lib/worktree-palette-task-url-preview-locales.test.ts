import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import {
  getCmdJTaskUrlCreatePreview,
  parseCmdJTaskSourceUrl,
  withResolvedCmdJGitHubPreview
} from './worktree-palette-task-url-match'

const cases = [
  {
    url: 'https://github.com/stablyai/orca/issues/14198',
    provider: 'github',
    identifier: '#14198',
    subtitle: 'stablyai/orca'
  },
  {
    url: 'https://github.com/stablyai/orca/pull/12789',
    provider: 'github',
    identifier: '#12789',
    subtitle: 'stablyai/orca'
  },
  {
    url: 'https://gitlab.com/acme/orca/-/issues/18',
    provider: 'gitlab',
    identifier: '#18',
    subtitle: 'gitlab.com/acme/orca'
  },
  {
    url: 'https://gitlab.com/acme/orca/-/merge_requests/17',
    provider: 'gitlab',
    identifier: '!17',
    subtitle: 'gitlab.com/acme/orca'
  },
  {
    url: 'https://company.atlassian.net/browse/ORCA-123',
    provider: 'jira',
    identifier: 'ORCA-123',
    subtitle: 'company.atlassian.net'
  }
]

const locales = [
  {
    locale: 'en',
    kinds: [
      'GitHub issue',
      'GitHub pull request',
      'GitLab issue',
      'GitLab merge request',
      'Jira issue'
    ],
    labels: [
      'Create worktree from GitHub issue stablyai/orca#14198',
      'Create worktree from GitHub pull request stablyai/orca#12789',
      'Create worktree from GitLab issue gitlab.com/acme/orca#18',
      'Create worktree from GitLab merge request gitlab.com/acme/orca!17',
      'Create worktree from Jira issue ORCA-123'
    ]
  },
  {
    locale: 'es',
    kinds: [
      'Incidencia de GitHub',
      'Solicitud de incorporación de GitHub',
      'Incidencia de GitLab',
      'Solicitud de fusión de GitLab',
      'Issue de Jira'
    ],
    labels: [
      'Crear árbol de trabajo desde la incidencia de GitHub stablyai/orca#14198',
      'Crear árbol de trabajo desde la solicitud de incorporación de GitHub stablyai/orca#12789',
      'Crear árbol de trabajo desde la incidencia de GitLab gitlab.com/acme/orca#18',
      'Crear árbol de trabajo desde la solicitud de fusión de GitLab gitlab.com/acme/orca!17',
      'Crear árbol de trabajo desde la incidencia de Jira ORCA-123'
    ]
  },
  {
    locale: 'fr',
    kinds: [
      'Issue GitHub',
      'Demande de fusion GitHub',
      'Issue GitLab',
      'Demande de fusion GitLab',
      'Ticket Jira'
    ],
    labels: [
      "Créer un worktree à partir de l'issue GitHub stablyai/orca#14198",
      'Créer un worktree à partir de la demande de fusion GitHub stablyai/orca#12789',
      "Créer un worktree à partir de l'issue GitLab gitlab.com/acme/orca#18",
      'Créer un worktree à partir de la demande de fusion GitLab gitlab.com/acme/orca!17',
      'Créer un worktree à partir du ticket Jira ORCA-123'
    ]
  },
  {
    locale: 'ja',
    kinds: [
      'GitHub Issue',
      'GitHub プルリクエスト',
      'GitLab Issue',
      'GitLab マージリクエスト',
      'Jira Issue'
    ],
    labels: [
      'GitHub Issue stablyai/orca#14198 からワークツリーを作成',
      'GitHub プルリクエスト stablyai/orca#12789 からワークツリーを作成',
      'GitLab Issue gitlab.com/acme/orca#18 からワークツリーを作成',
      'GitLab マージリクエスト gitlab.com/acme/orca!17 からワークツリーを作成',
      'Jira Issue ORCA-123 からワークツリーを作成'
    ]
  },
  {
    locale: 'ko',
    kinds: ['GitHub 이슈', 'GitHub 풀 리퀘스트', 'GitLab 이슈', 'GitLab 병합 요청', 'Jira 이슈'],
    labels: [
      'GitHub 이슈 stablyai/orca#14198에서 워크트리 생성',
      'GitHub 풀 리퀘스트 stablyai/orca#12789에서 워크트리 생성',
      'GitLab 이슈 gitlab.com/acme/orca#18에서 워크트리 생성',
      'GitLab 병합 요청 gitlab.com/acme/orca!17에서 워크트리 생성',
      'Jira 이슈 ORCA-123에서 워크트리 생성'
    ]
  },
  {
    locale: 'zh',
    kinds: ['GitHub 议题', 'GitHub 拉取请求', 'GitLab 议题', 'GitLab 合并请求', 'Jira 议题'],
    labels: [
      '从 GitHub 议题 stablyai/orca#14198 创建工作树',
      '从 GitHub 拉取请求 stablyai/orca#12789 创建工作树',
      '从 GitLab 议题 gitlab.com/acme/orca#18 创建工作树',
      '从 GitLab 合并请求 gitlab.com/acme/orca!17 创建工作树',
      '从 Jira 议题 ORCA-123 创建工作树'
    ]
  }
]

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('localized task URL create previews', () => {
  it.each(locales)(
    'renders complete $locale copy without changing task identity',
    async ({ locale, kinds, labels }) => {
      await i18n.changeLanguage(locale)
      cases.forEach(({ url, provider, identifier, subtitle }, index) => {
        const intent = parseCmdJTaskSourceUrl(url)!
        const identity = structuredClone(intent)
        const preview = getCmdJTaskUrlCreatePreview(intent)!
        expect(preview).toEqual({
          provider,
          identifier,
          subtitle,
          kindLabel: kinds[index],
          createLabel: labels[index]
        })
        expect(intent).toEqual(identity)
        if (provider === 'github') {
          const title = 'Orca task at https://github.com/user/Orca#17'
          expect(withResolvedCmdJGitHubPreview(preview, title, false)).toMatchObject({
            identifier,
            subtitle: title,
            createLabel: `${labels[index]}: ${title}`,
            loading: false
          })
        }
      })
    }
  )
})
