export const workflowRoleReportNames = {
  product: 'requirements.md',
  developer: 'implementation.md',
  tester: 'test-report.md',
  ops: 'release-plan.md'
} as const

type RoleArtifactName =
  | (typeof workflowRoleReportNames)[keyof typeof workflowRoleReportNames]
  | 'review.json'

/** Select from the complete immutable manifest; retain the original path and version. */
export function selectWorkflowRoleArtifact<T extends { name: string }>(
  artifacts: readonly T[],
  name: RoleArtifactName
): T | undefined {
  if (
    artifacts.some(
      (artifact) =>
        /[\\:\0]/.test(artifact.name) ||
        artifact.name.split('/').some((part) => !part || part === '.' || part === '..')
    )
  ) {
    throw new Error('workflow_role_artifact_path_invalid')
  }
  const matches = artifacts.filter((artifact) => artifact.name.split('/').at(-1) === name)
  if (matches.length > 1) {
    throw new Error('workflow_role_artifact_ambiguous')
  }
  return matches[0]
}
