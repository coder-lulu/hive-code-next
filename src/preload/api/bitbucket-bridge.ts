import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const bitbucketApi: PreloadApi['bitbucket'] = {
  connect: (args) => ipcRenderer.invoke('bitbucket:connect', args),
  disconnect: () => ipcRenderer.invoke('bitbucket:disconnect'),
  status: () => ipcRenderer.invoke('bitbucket:status')
}
