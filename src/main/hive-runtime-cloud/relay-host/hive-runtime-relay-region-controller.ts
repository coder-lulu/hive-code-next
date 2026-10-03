import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type {
  HiveRuntimeRelayControlCommandAck,
  HiveRuntimeRelayRegionMeasurement,
  HiveRuntimeRelayRegionMeasurementWindow,
  HiveRuntimeRelayRehomeCommand
} from './hive-runtime-relay-heartbeat-types'
import { measureHiveRuntimeRelayRegions } from './hive-runtime-relay-region-measurement'

type Options = {
  dynamic: boolean
  getAssignment: () => HiveRuntimeRelayAssignment | null
  getConnectionCount: () => number
  isActive: () => boolean
  requestHeartbeat: () => void
  reconnect: () => void
  setCommandAck: (ack: HiveRuntimeRelayControlCommandAck | null) => void
  measureRegions?: (
    window: HiveRuntimeRelayRegionMeasurementWindow
  ) => Promise<HiveRuntimeRelayRegionMeasurement>
}

export class HiveRuntimeRelayRegionController {
  private measurement: HiveRuntimeRelayRegionMeasurement | null = null
  private measuredWindowKey: string | null = null
  private measurementGeneration = 0
  private pendingRehome: HiveRuntimeRelayRehomeCommand | null = null
  private rehomeAcknowledged = false
  private rehomeInProgress = false

  constructor(private readonly options: Options) {}

  get reportedMeasurement(): HiveRuntimeRelayRegionMeasurement | null {
    return this.options.dynamic ? this.measurement : null
  }

  get canAcceptConnection(): boolean {
    return !this.pendingRehome && !this.rehomeInProgress
  }

  stop(): void {
    this.measurementGeneration++
  }

  assigned(ownerChanged: boolean): void {
    if (ownerChanged) {
      this.reset()
    }
    this.rehomeInProgress = false
  }

  acceptResponse(
    sentAck: HiveRuntimeRelayControlCommandAck | null,
    ackedControlSequence: number,
    sentMeasurement: HiveRuntimeRelayRegionMeasurement | null
  ): void {
    if (
      this.pendingRehome &&
      sentAck?.commandId === this.pendingRehome.commandId &&
      sentAck.sequence === this.pendingRehome.sequence &&
      ackedControlSequence >= sentAck.sequence
    ) {
      this.rehomeAcknowledged = true
    }
    if (
      sentMeasurement &&
      this.measurement?.windowGeneration === sentMeasurement.windowGeneration
    ) {
      this.measurement = null
    }
  }

  acceptCommand(
    command: HiveRuntimeRelayRehomeCommand,
    assignment: HiveRuntimeRelayAssignment
  ): void {
    if (
      !this.options.dynamic ||
      command.assignmentId !== assignment.assignmentId ||
      command.assignmentEpoch !== assignment.assignmentEpoch
    ) {
      return
    }
    this.pendingRehome = command
    this.rehomeAcknowledged = false
    this.requestAcknowledgement()
  }

  acceptWindow(
    window: HiveRuntimeRelayRegionMeasurementWindow,
    assignment: HiveRuntimeRelayAssignment
  ): void {
    if (
      !this.options.dynamic ||
      window.assignmentId !== assignment.assignmentId ||
      window.assignmentEpoch !== assignment.assignmentEpoch
    ) {
      return
    }
    const key = `${window.assignmentId}:${window.assignmentEpoch}:${window.generation}`
    if (this.measuredWindowKey === key || this.measurement || Date.now() >= window.expiresAt) {
      return
    }
    this.measuredWindowKey = key
    const generation = ++this.measurementGeneration
    const measure = this.options.measureRegions ?? measureHiveRuntimeRelayRegions
    void measure(window).then(
      (measurement) => {
        const current = this.options.getAssignment()
        if (
          generation !== this.measurementGeneration ||
          !this.options.isActive() ||
          !this.options.dynamic ||
          current?.assignmentId !== window.assignmentId ||
          current.assignmentEpoch !== window.assignmentEpoch
        ) {
          return
        }
        this.measurement = measurement
        this.options.requestHeartbeat()
      },
      () => {
        if (generation === this.measurementGeneration) {
          this.measuredWindowKey = null
        }
      }
    )
  }

  onIdle(): void {
    if (!this.options.isActive() || !this.pendingRehome) {
      return
    }
    if (this.rehomeAcknowledged) {
      this.maybeReconnect()
    } else {
      this.requestAcknowledgement()
    }
  }

  afterResponse(): void {
    this.maybeReconnect()
  }

  private requestAcknowledgement(): void {
    const command = this.pendingRehome
    if (!command || this.rehomeAcknowledged || this.options.getConnectionCount() !== 0) {
      return
    }
    this.options.setCommandAck({
      sequence: command.sequence,
      commandId: command.commandId,
      acknowledgedResourceVersion: command.targetResourceVersion
    })
    this.options.requestHeartbeat()
  }

  private maybeReconnect(): void {
    if (
      !this.pendingRehome ||
      !this.rehomeAcknowledged ||
      this.options.getConnectionCount() !== 0 ||
      this.rehomeInProgress
    ) {
      return
    }
    this.rehomeInProgress = true
    this.measurementGeneration++
    this.options.reconnect()
  }

  private reset(): void {
    this.measurementGeneration++
    this.options.setCommandAck(null)
    this.measurement = null
    this.measuredWindowKey = null
    this.pendingRehome = null
    this.rehomeAcknowledged = false
    this.rehomeInProgress = false
  }
}
