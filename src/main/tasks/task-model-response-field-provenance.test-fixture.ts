export const documentedResponseDiagnosticKeys = [
  'cyber',
  'context',
  'effort',
  'generate_summary',
  'mode',
  'summary',
  'format',
  'verbosity',
  'type',
  'name',
  'schema',
  'description',
  'strict',
  'output_text'
] as const

export const responseFieldProvenanceCases: {
  label: string
  response: Record<string, unknown>
  location: string
  reason: string
  key?: string
}[] = [
  {
    label: 'root documented name',
    response: { cyber: 'synthetic' },
    location: 'response',
    reason: 'UNKNOWN_FIELD',
    key: 'cyber'
  },
  {
    label: 'access unknown documented name',
    response: { access_programs: { context: 'synthetic' } },
    location: 'response_access_programs',
    reason: 'UNKNOWN_FIELD',
    key: 'context'
  },
  {
    label: 'reasoning unknown documented name',
    response: { reasoning: { cyber: 'synthetic' } },
    location: 'response_reasoning',
    reason: 'UNKNOWN_FIELD',
    key: 'cyber'
  },
  {
    label: 'text unknown documented name',
    response: { text: { cyber: 'synthetic' } },
    location: 'response_text',
    reason: 'UNKNOWN_FIELD',
    key: 'cyber'
  },
  {
    label: 'format unknown documented name',
    response: { text: { format: { cyber: 'synthetic' } } },
    location: 'response_text_format',
    reason: 'UNKNOWN_FIELD',
    key: 'cyber'
  },
  ...['name', 'schema', 'description', 'strict'].map((key) => ({
    label: `unsupported schema ${key} name`,
    response: { text: { format: { type: 'json_schema', [key]: 'synthetic' } } },
    location: 'response_text_format',
    reason: 'UNKNOWN_FIELD',
    key
  })),
  {
    label: 'malformed access object',
    response: { access_programs: false },
    location: 'response_access_programs',
    reason: 'OBJECT'
  },
  {
    label: 'access enum mismatch',
    response: { access_programs: { cyber: 'unapproved' } },
    location: 'response_access_programs',
    reason: 'ENUM'
  },
  {
    label: 'reasoning mismatch',
    response: { reasoning: { effort: 'high' } },
    location: 'response_reasoning',
    reason: 'RESPONSE_CONFIGURATION',
    key: 'reasoning'
  },
  {
    label: 'text mismatch',
    response: { text: { verbosity: 'high' } },
    location: 'response_text',
    reason: 'RESPONSE_CONFIGURATION',
    key: 'text'
  },
  {
    label: 'format enum mismatch',
    response: { text: { format: { type: 'json_object' } } },
    location: 'response_text_format',
    reason: 'ENUM'
  },
  {
    label: 'SDK convenience field remains refused',
    response: { output_text: 'synthetic' },
    location: 'response',
    reason: 'UNKNOWN_FIELD',
    key: 'output_text'
  },
  ...[
    { location: 'response', response: { 'private-key': 'body-token-secret' } },
    {
      location: 'response_access_programs',
      response: { access_programs: { 'private-key': 'body-token-secret' } }
    },
    {
      location: 'response_reasoning',
      response: { reasoning: { 'private-key': 'body-token-secret' } }
    },
    { location: 'response_text', response: { text: { 'private-key': 'body-token-secret' } } },
    {
      location: 'response_text_format',
      response: { text: { format: { 'private-key': 'body-token-secret' } } }
    }
  ].map((value) => ({
    ...value,
    label: `sensitive unknown at ${value.location}`,
    reason: 'UNKNOWN_FIELD',
    key: 'other'
  }))
]
