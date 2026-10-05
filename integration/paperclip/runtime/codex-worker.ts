import { startTaskDockerWorker } from '../../../src/main/tasks/task-docker-worker'

await startTaskDockerWorker().catch(() => {
  process.stderr.write('TASK_DOCKER_WORKER_UNAVAILABLE\n')
  process.exitCode = 2
})
