import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { WorkflowTeamBindingSchema } from './workflow-bindings'
import { WorkflowDefinitionSchema } from './workflow-definition'
import {
  WorkflowDeploymentApprovalSchema,
  WorkflowHandoffSchema,
  WorkflowReviewSchema,
  WorkflowSharedEventSchema
} from './workflow-evidence'

export const workflowTestVectors = z
  .strictObject({
    examples: z.strictObject({
      team: WorkflowTeamBindingSchema,
      definition: WorkflowDefinitionSchema,
      handoff: WorkflowHandoffSchema,
      review: WorkflowReviewSchema,
      approval: WorkflowDeploymentApprovalSchema,
      sharedEvent: WorkflowSharedEventSchema
    }),
    bindingCases: z.array(
      z.strictObject({
        name: z.string(),
        target: z.enum(['review', 'approval']),
        path: z.array(z.string()).min(1),
        value: z.unknown(),
        expected: z.string()
      })
    )
  })
  .parse(
    JSON.parse(readFileSync(resolve('integration/contracts/workflow-v1/test-vectors.json'), 'utf8'))
  )
