import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { createUIStore } from './ui-slice-test-harness'

describe('createUISlice Activity navigation', () => {
  it('defaults to the all scope', () => {
    const store = createUIStore()

    expect(store.getState().activityPageScope).toBe('all')
  })

  it('keeps the maintained Activity view available without the old experiment gate', () => {
    const store = createUIStore()
    store.setState({
      activeView: 'tasks',
      settings: { ...getDefaultSettings('/tmp'), experimentalActivity: false }
    })

    store.getState().openActivityPage()

    expect(store.getState().activeView).toBe('activity')
    expect(store.getState().previousViewBeforeActivity).toBe('tasks')
    expect(store.getState().activityPageScope).toBe('all')
  })

  it('opens the all scope when the experiment is enabled', () => {
    const store = createUIStore()
    store.setState({
      activeView: 'tasks',
      settings: { ...getDefaultSettings('/tmp'), experimentalActivity: true }
    })

    store.getState().openActivityPage()

    expect(store.getState().activeView).toBe('activity')
    expect(store.getState().previousViewBeforeActivity).toBe('tasks')
    expect(store.getState().activityPageScope).toBe('all')
  })

  it('opens temporary sessions without the Activity experiment', () => {
    const store = createUIStore()
    store.setState({
      activeView: 'settings',
      settings: { ...getDefaultSettings('/tmp'), experimentalActivity: false }
    })

    store.getState().openActivityPage({ scope: 'temporary-sessions' })

    expect(store.getState().activeView).toBe('activity')
    expect(store.getState().previousViewBeforeActivity).toBe('settings')
    expect(store.getState().activityPageScope).toBe('temporary-sessions')
  })

  it('preserves the original return view when the Activity scope changes', () => {
    const store = createUIStore()
    store.setState({
      activeView: 'tasks',
      settings: { ...getDefaultSettings('/tmp'), experimentalActivity: true }
    })

    store.getState().openActivityPage()
    store.getState().openActivityPage({ scope: 'temporary-sessions' })

    expect(store.getState().previousViewBeforeActivity).toBe('tasks')
    expect(store.getState().activityPageScope).toBe('temporary-sessions')
  })

  it('returns to the previous view and resets the scope on close', () => {
    const store = createUIStore()
    store.setState({
      activeView: 'settings',
      settings: { ...getDefaultSettings('/tmp'), experimentalActivity: false }
    })
    store.getState().openActivityPage({ scope: 'temporary-sessions' })

    store.getState().closeActivityPage()

    expect(store.getState().activeView).toBe('settings')
    expect(store.getState().activityPageScope).toBe('all')
  })
})
