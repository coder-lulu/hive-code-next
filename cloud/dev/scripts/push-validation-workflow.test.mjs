import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkflow } from './cloud-workflow-repository.mjs'

const workflow = readWorkflow('push-deploy.yml')
const position = (name) => {
  const index = workflow.indexOf(`- name: ${name}`)
  assert.notEqual(index, -1)
  return index
}

test('the immutable image is built and verified before the candidate is deployed', () => {
  assert.match(workflow, /docker build -f/)
  assert.match(workflow, /docker push/)
  assert.match(workflow, /IMAGE_DIGEST/)
  assert.ok(position('Build and publish the immutable gateway image') < position('Deploy the candidate revision with no traffic'))
  assert.ok(position('Require the candidate to serve the exact image and inherited scaling') < position('Shift all traffic to the verified candidate'))
})

test('candidate readiness and public health are checked before and after traffic shift', () => {
  assert.ok(position('Probe the candidate readiness endpoint') < position('Shift all traffic to the verified candidate'))
  assert.ok(position('Verify the public origin after the shift') > position('Shift all traffic to the verified candidate'))
  assert.match(workflow, /deliveryProtocol == 2/)
})
