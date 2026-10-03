import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n/i18n'
import {
  isNonFastForwardRemoteError,
  resolveRemoteOperationErrorMessage
} from './source-control-remote-error'

describe('source-control remote error formatting', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en')
  })

  it('prefers fatal detail over an earlier remote detail for publish failures', () => {
    const error = new Error('remote: protected branch\r\nfatal: Authentication failed\r\n')

    expect(resolveRemoteOperationErrorMessage(error, { publish: true })).toBe(
      'Publish Branch failed. Authentication failed. Check your remote access and try again.'
    )
  })

  it('maps pre-push hook failures to a hook-specific message instead of remote access guidance', () => {
    const error = new Error(
      "git push failed: Command failed: git push origin main\nerror: failed to push some refs to 'origin'\nhusky - pre-push hook exited with code 1\neslint found 2 errors"
    )

    expect(resolveRemoteOperationErrorMessage(error, { isPush: true })).toBe(
      'Push blocked — lint failed during push.'
    )
  })

  it('maps force-push, publish, and sync push-stage hook failures to blocked copy', () => {
    const error = new Error(
      "git push failed: Command failed: git push origin main\nerror: failed to push some refs to 'origin'\nhusky - pre-push hook exited with code 1"
    )

    expect(resolveRemoteOperationErrorMessage(error, { isForcePush: true })).toBe(
      'Force Push blocked — pre-push hook failed.'
    )
    expect(resolveRemoteOperationErrorMessage(error, { publish: true })).toBe(
      'Publish Branch blocked — pre-push hook failed.'
    )
    expect(resolveRemoteOperationErrorMessage(error, { isSync: true, isSyncPushStage: true })).toBe(
      'Sync blocked — pre-push hook failed.'
    )
  })

  it('does not classify sync non-push-stage hook-looking output as push blocked', () => {
    const error = new Error(
      'sync fetch failed before push\nremote: pre-push hook docs mention lint\neslint output'
    )

    const message = resolveRemoteOperationErrorMessage(error, { isSync: true })
    expect(message).toBe(
      'Sync failed. pre-push hook docs mention lint. Check your remote access and try again.'
    )
    expect(message).not.toContain('blocked')
  })

  it('keeps auth, protected-branch, pre-receive, non-fast-forward, and submodule push guidance out of blocked copy', () => {
    const protectedError = new Error(
      'git push failed: Command failed: git push origin main\nremote: error: GH006 protected branch update failed.\nremote: lint status is required'
    )
    const preReceiveError = new Error(
      'git push failed: Command failed: git push origin main\nremote: pre-receive hook declined\nremote: eslint failed'
    )
    const authError = new Error(
      'git push failed: Command failed: git push origin main\nremote: Repository not found.\nfatal: Authentication failed'
    )
    const nffError = new Error('updates were rejected because the remote contains work')
    const submoduleError = new Error(
      "Command failed: git push\nUnable to push submodule 'deps/lib'\nfatal: failed to push all needed submodules"
    )

    expect(resolveRemoteOperationErrorMessage(protectedError, { isPush: true })).toBe(
      'Push failed. error: GH006 protected branch update failed.. Check your remote access and try again.'
    )
    expect(resolveRemoteOperationErrorMessage(preReceiveError, { isPush: true })).toBe(
      'Push failed. pre-receive hook declined. Check your remote access and try again.'
    )
    expect(resolveRemoteOperationErrorMessage(authError, { isPush: true })).toBe(
      'Push failed. Authentication failed. Check your remote access and try again.'
    )
    expect(resolveRemoteOperationErrorMessage(nffError, { isPush: true })).toBe(
      'Push rejected — remote has changes. Pull first, then try again.'
    )
    expect(resolveRemoteOperationErrorMessage(submoduleError, { isPush: true })).toBe(
      "Push failed. Submodule 'deps/lib' could not be pushed. Resolve the submodule push error, then try again."
    )
  })

  it('extracts publish details from newline-heavy output without full line-array splitting', () => {
    const splitSpy = vi.spyOn(String.prototype, 'split')
    const replaceSpy = vi.spyOn(String.prototype, 'replace')
    const progress = 'remote: Enumerating objects\r\n'.repeat(10_000)
    const error = new Error(
      `${progress}fatal: unable to access https://token:secret@example.com/repo.git\r\n`
    )

    const result = resolveRemoteOperationErrorMessage(error, { publish: true })

    expect(result).toContain('Publish Branch failed. unable to access https://example.com/repo.git')
    const usedLineSplit = splitSpy.mock.calls.some(([separator]) => {
      if (typeof separator === 'string') {
        return separator === '\n'
      }
      return separator instanceof RegExp && separator.source === '\\r?\\n'
    })
    const usedCrlfReplace = replaceSpy.mock.calls.some(
      ([pattern]) => pattern instanceof RegExp && pattern.source === '\\r\\n'
    )
    expect(usedLineSplit).toBe(false)
    expect(usedCrlfReplace).toBe(false)
  })

  it('retains credential redaction, SSH users, and the detail truncation boundary', () => {
    const detail = `denied https://token:secret@example.com/repo.git ssh://git@example.com/repo.git ${'x'.repeat(300)}`
    const redacted = detail.replace('token:secret@', '')
    expect(resolveRemoteOperationErrorMessage(new Error(detail), { isFetch: true })).toBe(
      `Fetch failed. ${redacted.slice(0, 200).trimEnd()}...`
    )
  })

  it('keeps opaque submodule names and normalized non-fast-forward classification', () => {
    const name = 'deps/{{scope}}/HiveCode/Orca'
    const detail = `Submodule '${name}' has remote changes. Pull inside the submodule, then try again.`
    const error = new Error(detail)
    expect(resolveRemoteOperationErrorMessage(error, { isPush: true })).toBe(
      `Push failed. ${detail}`
    )
    expect(isNonFastForwardRemoteError(error)).toBe(true)
  })

  it('keeps unclassified Git output and raw hook summaries in their existing form', () => {
    const raw = 'server diagnostic: custom HiveCode/Orca repository rule'
    expect(resolveRemoteOperationErrorMessage(new Error(raw))).toBe(raw)
    expect(
      resolveRemoteOperationErrorMessage(
        new Error('Build step crashed.\nerror: hook declined to push'),
        { isPush: true }
      )
    ).toBe('Push blocked — build step crashed.')
  })

  it.each([
    {
      locale: 'en',
      failure: 'Push failed.',
      submodule: 'Submodule',
      lint: 'lint failed during push.',
      conflict: 'Rebase blocked',
      fallback: 'Remote operation failed'
    },
    {
      locale: 'zh',
      failure: '推送失败',
      submodule: '子模块',
      lint: '推送期间的代码检查失败。',
      conflict: '变基被阻止',
      fallback: '远程操作失败'
    },
    {
      locale: 'ja',
      failure: 'プッシュに失敗しました',
      submodule: 'サブモジュール',
      lint: 'プッシュ中の静的解析に失敗しました。',
      conflict: 'リベースがブロックされました',
      fallback: 'リモート操作に失敗しました'
    },
    {
      locale: 'ko',
      failure: '푸시 실패',
      submodule: '하위 모듈',
      lint: '푸시 중 코드 검사에 실패했습니다.',
      conflict: '리베이스가 차단되었습니다',
      fallback: '원격 작업 실패'
    },
    {
      locale: 'fr',
      failure: 'L’envoi a échoué',
      submodule: 'Le sous-module',
      lint: 'la vérification du code a échoué pendant l’envoi.',
      conflict: 'Rebasage impossible',
      fallback: 'L’opération distante a échoué'
    },
    {
      locale: 'es',
      failure: 'Error al enviar',
      submodule: 'El submódulo',
      lint: 'la comprobación del código ha fallado durante el envío.',
      conflict: 'La reorganización está bloqueada',
      fallback: 'La operación remota ha fallado'
    }
  ])(
    'localizes $locale explanations while retaining classification and opaque Git data',
    async ({ locale, failure, submodule, lint, conflict, fallback }) => {
      await i18n.changeLanguage(locale)
      const redactedDetail = 'Denied access to https://example.com/HiveCode/Orca.git'
      const accessError = new Error(
        'fatal: Denied access to https://token:secret@example.com/HiveCode/Orca.git'
      )
      const accessMessage = resolveRemoteOperationErrorMessage(accessError, { isPush: true })
      expect(accessMessage).toContain(failure)
      expect(accessMessage).toContain(redactedDetail)
      expect(accessMessage).not.toContain('token:secret')
      expect(accessMessage).not.toContain('{{operation}}')

      const name = 'deps/{{scope}}/HiveCode/Orca'
      const submoduleError = new Error(
        `Submodule '${name}' has remote changes. Pull inside the submodule, then try again.`
      )
      const submoduleMessage = resolveRemoteOperationErrorMessage(submoduleError, { isPush: true })
      expect(submoduleMessage).toContain(submodule)
      expect(submoduleMessage).toContain(name)
      expect(isNonFastForwardRemoteError(submoduleError)).toBe(true)

      const hookError = new Error('git push failed\nhusky - pre-push hook failed\neslint failed')
      expect(resolveRemoteOperationErrorMessage(hookError, { isPush: true })).toContain(lint)
      expect(
        resolveRemoteOperationErrorMessage(new Error('unmerged files'), { isRebase: true })
      ).toContain(conflict)
      expect(resolveRemoteOperationErrorMessage(null)).toBe(fallback)

      // A server can emit text identical to a generated summary. Its original
      // spelling and case must survive when the shared classifier treats it as data.
      const serverError = new Error(
        'remote: Lint failed during push.\nremote: pre-receive hook declined'
      )
      expect(resolveRemoteOperationErrorMessage(serverError, { isPush: true })).toContain(
        'Lint failed during push.'
      )
      expect(
        resolveRemoteOperationErrorMessage(
          new Error('Push failed.\nerror: hook declined to push'),
          { isPush: true }
        )
      ).toContain('push failed.')

      const raw = 'arbitrary Git server output for HiveCode/Orca'
      expect(resolveRemoteOperationErrorMessage(new Error(raw))).toBe(raw)
      const longDetail = `custom server reason ${'x'.repeat(300)}`
      expect(
        resolveRemoteOperationErrorMessage(new Error(longDetail), { isFetch: true })
      ).toContain(`${longDetail.slice(0, 200)}...`)
    }
  )
})
