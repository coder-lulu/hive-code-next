import { OrcaCloudRequestError } from '../orca-profiles/profile-cloud-client'
import { artifactRequest } from './artifact-cloud-request'

export async function deleteArtifactRequest(
  apiUrl: string,
  token: string,
  path: string,
  editToken?: string
): Promise<void> {
  try {
    await artifactRequest<void>(apiUrl, token, path, {
      method: 'DELETE',
      ...(editToken ? { editToken } : {})
    })
  } catch (error) {
    if (
      !(error instanceof OrcaCloudRequestError) ||
      error.statusCode !== 404 ||
      error.errorCode !== 'artifact_not_found'
    ) {
      throw error
    }
  }
}
