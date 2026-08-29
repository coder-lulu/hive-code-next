// Compatibility facade for the historical Linear issue service import.
// The implementation is split by operation, but runtime callers still use
// this stable module path; keeping the facade avoids a partial split breaking
// startup and RPC loading.
export {
  addIssueComment,
  addIssueCommentForAgent,
  createIssueAttachment
} from './linear-issue-comments'
export { getIssueComments } from './linear-issue-comments'
export { listIssues, type LinearListFilter } from './linear-issue-listing'
export {
  getIssue,
  getIssueByUuidForAgent,
  getCommentByUuidForAgent,
  getAttachmentByUuidForAgent,
  getIssueCommentThreadRoot,
  searchIssues
} from './linear-issue-lookups'
export {
  createIssue,
  createIssueForAgent,
  updateIssue,
  updateIssueForAgent
} from './linear-issue-mutations'
export { LinearWriteFailure } from './linear-issue-write-support'
export type { LinearIssueListOptions } from './linear-issue-query-documents'
