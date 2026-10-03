import type { PRCommentAudienceFilter } from '../../../../src/shared/pr-comment-audience'

export const PR_COMMENT_AUDIENCE_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'human', label: '用户' },
  { value: 'bot', label: '机器人' }
] satisfies { value: PRCommentAudienceFilter; label: string }[]

export function getPRCommentAudienceEmptyLabel(filter: PRCommentAudienceFilter): string {
  switch (filter) {
    case 'bot':
      return '暂无机器人评论。'
    case 'human':
      return '暂无用户评论。'
    case 'all':
      return '暂无评论。'
  }
}
