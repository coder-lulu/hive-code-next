import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hostedReviewApi: PreloadApi['hostedReview'] = {
  forBranch: (args) => ipcRenderer.invoke('hostedReview:forBranch', args),
  getCreationEligibility: (args) => ipcRenderer.invoke('hostedReview:getCreationEligibility', args),
  create: (args) => ipcRenderer.invoke('hostedReview:create', args),
  createStacked: (args) => ipcRenderer.invoke('hostedReview:createStacked', args)
}
