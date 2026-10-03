export const controlCommand = {
  requestId: '11111111-1111-4111-8111-111111111111',
  runtime: {
    authorityGeneration: 1,
    runtimeRecordId: '44444444-4444-4444-8444-444444444444',
    runtimeInstanceId: '55555555-5555-4555-8555-555555555555',
    bootId: '66666666-6666-4666-8666-666666666666',
    heartbeatLeaseId: '77777777-7777-4777-8777-777777777777',
    leaseEpoch: 1,
    fencingEpoch: 1
  }
}
export const controlOwner = {
  accountId: '88888888-8888-4888-8888-888888888888',
  deviceId: '99999999-9999-4999-8999-999999999999',
  runtimeRecordId: controlCommand.runtime.runtimeRecordId
}
export const controlReply = {
  contract: 'hive-ai-text-control-v1',
  requestId: controlCommand.requestId,
  generationId: 'ha-generation:33333333-3333-4333-8333-333333333333',
  modelId: 'vendor/model',
  protocol: 'CHAT_COMPLETIONS',
  state: 'UNKNOWN',
  createdAt: '2026-09-15T00:00:00Z',
  execution: null
}
