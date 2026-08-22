import { describe, expect, it } from 'vitest'

import {
  CANONICAL_PRODUCT_DESIGN,
  verifyDocumentationGovernance
} from './verify-documentation-governance.mjs'

const REQUIRED_DESIGN = [
  '## 1. 文档权威与维护规则',
  '## 3. 当前能力基线',
  '## 4. 总体架构',
  '## 5. 功能设计',
  '## 7. 开发路线',
  '## 10. 已合并资料处置'
].join('\n')

function verify(contents) {
  return verifyDocumentationGovernance({
    files: Object.keys(contents),
    readText: (filePath) => contents[filePath]
  })
}

describe('documentation governance', () => {
  it('accepts one canonical design plus narrow reference documents', () => {
    expect(
      verify({
        [CANONICAL_PRODUCT_DESIGN]: REQUIRED_DESIGN,
        'README.md': `[Design](${CANONICAL_PRODUCT_DESIGN})`,
        'docs/reference/remote-wire-compatibility.md': '# Remote wire compatibility'
      })
    ).toEqual([])
  })

  it('rejects a missing canonical design', () => {
    expect(verify({ 'README.md': '# Project' })).toContain(
      `Missing canonical product design: ${CANONICAL_PRODUCT_DESIGN}`
    )
  })

  it('rejects historical and parallel version documents', () => {
    const errors = verify({
      [CANONICAL_PRODUCT_DESIGN]: REQUIRED_DESIGN,
      'README.md': `[Design](${CANONICAL_PRODUCT_DESIGN})`,
      'docs/agent-skill-sharing-installation-plan.md': '# Old plan',
      'docs/new-roadmap-v2.md': '# Parallel roadmap'
    })

    expect(errors).toContain(
      'Consolidated historical document must not return: docs/agent-skill-sharing-installation-plan.md'
    )
    expect(errors).toContain(
      'Parallel plan/version document is not allowed: docs/new-roadmap-v2.md'
    )
  })
})
