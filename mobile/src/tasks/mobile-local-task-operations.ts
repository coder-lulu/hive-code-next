import { defineRpcOperation } from '../transport/rpc-operation'
import {
  parseMobileLocalSessionInventory,
  parseMobileLocalWorktreeMetadata
} from './mobile-local-task-rpc'

export const localSessionInventory = defineRpcOperation({
  name: 'tasks.localSessionInventory',
  method: 'session.tabs.listAll',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: (value: unknown) => ({
    compatible: true as const,
    variant: 'inventory' as const,
    value: parseMobileLocalSessionInventory(value),
    salvage: { droppedPaths: [], droppedCount: 0 }
  })
})

export const localWorktreeMetadata = defineRpcOperation({
  name: 'tasks.localWorktreeMetadata',
  method: 'worktree.ps',
  acceptance: 'require-result-or-throw',
  barrier: 'on-settle',
  read: (value: unknown) => ({
    compatible: true as const,
    variant: 'metadata' as const,
    value: parseMobileLocalWorktreeMetadata(value),
    salvage: { droppedPaths: [], droppedCount: 0 }
  })
})
