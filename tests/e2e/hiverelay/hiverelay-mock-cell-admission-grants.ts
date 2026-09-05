import {
  digestMockCellCredential,
  type AdmissionRecord,
  type MockAdmissionGrant
} from './hiverelay-mock-cell-state'

export function registerMockCellAdmissionGrant(
  admissions: Map<string, AdmissionRecord>,
  grant: MockAdmissionGrant
): void {
  const tokenDigest = digestMockCellCredential(grant.token)
  if (admissions.has(tokenDigest)) {
    throw new Error('Duplicate mock admission token')
  }
  const { token: _token, ...binding } = grant
  admissions.set(tokenDigest, { ...binding, state: 'UNUSED' })
}
