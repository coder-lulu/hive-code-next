/**
 * Guards the localized relative-duration copy for the Cmd+J session-age badge and the
 * native-chat turn row. The English source values ("{{value0}}m/h/d", "Working for N") are
 * ambiguous, so bootstrap re-translation rendered them as a metre (米), a location particle
 * (で / 에서), or a French infinitive. These are the reviewed values.
 */
import { describe, expect, it } from 'vitest'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'

const catalogs = { fr, ja, ko, zh } as const

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getByPath(node: unknown, path: string): string | undefined {
  let current: unknown = node
  for (const key of path.split('.')) {
    if (!isStringRecord(current)) {
      return undefined
    }
    current = current[key]
  }
  return typeof current === 'string' ? current : undefined
}

type Locale = keyof typeof catalogs

const AGE_PATHS = 'components.cmd-j.paletteSessionAge'
const STATUS_PATHS = 'components.native-chat.status'

const cases: [Locale, string, string][] = [
  // Cmd+J session-age badge: the unit must be a real duration word, not a bare Latin "m/h/d".
  ['zh', `${AGE_PATHS}.minutes`, '{{value0}} 分钟'],
  ['zh', `${AGE_PATHS}.hours`, '{{value0}} 小时'],
  ['zh', `${AGE_PATHS}.days`, '{{value0}} 天'],
  ['zh', `${AGE_PATHS}.underOneMinute`, '不到 1 分钟'],
  ['ja', `${AGE_PATHS}.hours`, '{{value0}} 時間'],
  ['ja', `${AGE_PATHS}.days`, '{{value0}} 日'],
  ['ja', `${AGE_PATHS}.underOneMinute`, '1 分未満'],
  ['ko', `${AGE_PATHS}.minutes`, '{{value0}}분'],
  ['ko', `${AGE_PATHS}.hours`, '{{value0}}시간'],
  ['ko', `${AGE_PATHS}.days`, '{{value0}}일'],
  // Native-chat turn row: elapsed time, not a recipient — "working/worked for <duration>",
  // never the location reading ("works at/for N").
  ['zh', `${STATUS_PATHS}.workingFor`, '已工作 {{value0}}'],
  ['zh', `${STATUS_PATHS}.workedFor`, '工作用时 {{value0}}'],
  ['ja', `${STATUS_PATHS}.workingFor`, '{{value0}} 作業中'],
  ['ja', `${STATUS_PATHS}.workedFor`, '{{value0}} 作業しました'],
  ['ko', `${STATUS_PATHS}.workingFor`, '{{value0}} 동안 작업 중'],
  ['ko', `${STATUS_PATHS}.workedFor`, '{{value0}} 동안 작업함'],
  ['fr', `${STATUS_PATHS}.workingFor`, 'Travail en cours depuis {{value0}}'],
  ['fr', `${STATUS_PATHS}.workedFor`, 'Travail effectué pendant {{value0}}'],
  // "turn" is a conversation turn (回合 / 턴 / tour), not a road turn (转弯 / 회전 / virage).
  ['zh', `${STATUS_PATHS}.toggleDetails`, '切换本轮详情'],
  ['ko', `${STATUS_PATHS}.toggleDetails`, '턴 상세 정보 전환'],
  ['fr', `${STATUS_PATHS}.toggleDetails`, 'Afficher ou masquer les détails du tour'],
  // Workspace-cleanup durations keep the day unit localized too.
  ['ja', 'components.workspace.cleanup.browse.chip.idleDays', '{{value0}} 日以上待機'],
  ['ko', 'components.workspace.cleanup.relativeTime.daysAgo', '{{value0}}일 전']
]

describe('relative-duration copy localization', () => {
  it.each(cases)('%s %s', (locale, path, expected) => {
    expect(getByPath(catalogs[locale], path), path).toBe(expected)
  })
})
