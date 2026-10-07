const replacements = {
  'pipeline-stage-config.ts': [
    ['  PipelineStageKind,\n', '', 1],
    ['kind: PipelineStageKind | string', 'kind: string', 1],
    [
      '(stage.config ?? {}) as PipelineStageConfig',
      '(stage.config ?? {}) satisfies PipelineStageConfig',
      1
    ],
    [
      '} = { ...config } as PipelineStageConfig & { assigneeAgentId?: unknown }',
      '}: PipelineStageConfig & { assigneeAgentId?: unknown } = { ...config }',
      1
    ],
    ['return rest as PipelineStageConfig', 'return rest', 1],
    ['const next = rest as PipelineStageConfig', 'const next: PipelineStageConfig = rest', 1],
    [
      'next.breakdown as Record<string, unknown>',
      'next.breakdown satisfies Record<string, unknown>',
      1
    ],
    ['id as string', 'id', 2]
  ],
  'pipeline-stage-breakdown.ts': [
    [
      'const record = policy as Record<string, unknown>',
      'const record: { version?: unknown; mode?: unknown; includeFields?: unknown; excludeFields?: unknown } = policy',
      1
    ]
  ],
  'pipeline-stage-ledger.ts': [
    [
      'const preference = readOptionalTrimmedString(value)',
      'const preference: unknown = readOptionalTrimmedString(value)',
      1
    ],
    [
      'value as IssueExecutionWorkspaceSettings',
      'value satisfies IssueExecutionWorkspaceSettings',
      1
    ]
  ],
  'pipeline-case-gates.ts': [
    [
      'const payload = first.payload as Record<string, unknown>',
      'const payload: Record<string, unknown> = first.payload',
      1
    ],
    [
      'const payload = latestApproval.payload as Record<string, unknown>',
      'const payload: Record<string, unknown> = latestApproval.payload',
      1
    ]
  ],
  'pipeline-case-rollups.ts': [
    [
      "import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'",
      "import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'",
      1
    ],
    [
      'const patch: Partial<typeof pipelineCases.$inferInsert> = { updatedAt: nowDate() }',
      "const patch: Omit<Partial<typeof pipelineCases.$inferInsert>, 'childCount' | 'terminalChildCount'> & { childCount?: number | SQL; terminalChildCount?: number | SQL } = { updatedAt: nowDate() }",
      1
    ],
    [' as unknown as number', '', 2]
  ]
}

export function normalizePaperclipCaseKernelTypes(module, content) {
  for (const [before, after, count] of replacements[module.split('/').pop()] ?? []) {
    if (content.split(before).length !== count + 1) {
      throw new Error('Paperclip Case type normalization input differs from the reviewed source')
    }
    content = content.replaceAll(before, after)
  }
  return content
}
