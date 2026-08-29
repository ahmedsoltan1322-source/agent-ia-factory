import { LocalDemoRuntimeAdapter } from './runtime.ts'
import {
  buildWorkerReceipt,
  validateWorkerBundle,
  type PortableWorkerBundle,
  type PortableWorkerReceipt,
} from './workerProtocol.ts'

export async function runReferenceWorkerBundle(
  rawBundle: PortableWorkerBundle,
  now = new Date().toISOString(),
): Promise<PortableWorkerReceipt> {
  const bundle = validateWorkerBundle(rawBundle, now)
  if (bundle.worker.supportedRuntimeAdapters[0] !== 'local-demo') throw new Error('REFERENCE_WORKER_RUNTIME_UNSUPPORTED')
  if (bundle.job.kind !== 'agent_run' || bundle.job.payload.agentId !== bundle.agent.id) {
    throw new Error('REFERENCE_WORKER_JOB_INVALID')
  }

  const adapter = new LocalDemoRuntimeAdapter()
  const run = await adapter.execute(bundle.agent, { task: bundle.job.payload.task })
  if (run.monetaryCostUsd !== 0 || run.toolCalls !== 0) throw new Error('REFERENCE_WORKER_ZERO_COST_BREACH')
  if (Date.parse(run.finishedAt) >= Date.parse(bundle.expiresAt)) throw new Error('REFERENCE_WORKER_LEASE_EXPIRED_DURING_RUN')
  return buildWorkerReceipt(bundle, run)
}