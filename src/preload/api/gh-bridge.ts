import { ghPullRequestsAndWorkItemsApi } from './gh-bridge-pull-requests-and-work-items'
import { ghMutationsAndProjectsApi } from './gh-bridge-mutations-and-projects'
import type { PreloadApi } from '../api-types'

export const ghApi: PreloadApi['gh'] = {
  ...ghPullRequestsAndWorkItemsApi,
  ...ghMutationsAndProjectsApi
}
