import { applyProductBranding } from '../../../shared/brand'

export class OrchestrationError extends Error {
  readonly code: string
  readonly data?: unknown

  constructor(code: string, message: string, data?: unknown) {
    super(applyProductBranding(message))
    this.name = 'OrchestrationError'
    this.code = code
    this.data = data
  }
}
