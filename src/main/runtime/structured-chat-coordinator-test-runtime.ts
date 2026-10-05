import { OrcaRuntimeService } from './orca-runtime'

export class CoordinatorMailTestRuntime extends OrcaRuntimeService {
  stopMail(): void {
    this.mailPointerRepointScheduler.clear()
    this._orchestrationDb = null
  }
}
