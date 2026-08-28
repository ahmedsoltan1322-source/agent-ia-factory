export type LocalModelState = 'idle' | 'loading' | 'ready' | 'error'

export interface LocalModelProgress {
  status?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

type ProgressListener = (progress: LocalModelProgress) => void

type WorkerResponse = {
  type: 'progress' | 'ready' | 'result' | 'error'
  requestId: string
  progress?: LocalModelProgress
  text?: string
  message?: string
}

type PendingRequest = {
  resolve: (value: string | void) => void
  reject: (error: Error) => void
  onProgress?: ProgressListener
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
}

export class LocalModelClient {
  private worker: Worker | null = null
  private pending = new Map<string, PendingRequest>()
  private ready = false

  isReady(): boolean {
    return this.ready
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const worker = new Worker(new URL('../workers/localModel.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.requestId)
      if (!pending) return

      if (response.type === 'progress') {
        pending.onProgress?.(response.progress ?? {})
        return
      }

      this.pending.delete(response.requestId)

      if (response.type === 'ready') {
        this.ready = true
        pending.resolve()
        return
      }

      if (response.type === 'result') {
        pending.resolve(response.text ?? '')
        return
      }

      pending.reject(new Error(response.message ?? 'LOCAL_MODEL_ERROR'))
    }

    worker.onerror = (event) => {
      const error = new Error(event.message || 'LOCAL_MODEL_WORKER_ERROR')
      for (const pending of this.pending.values()) {
        pending.reject(error)
      }
      this.pending.clear()
      this.ready = false
    }

    this.worker = worker
    return worker
  }

  async load(onProgress?: ProgressListener): Promise<void> {
    if (this.ready) return
    if (!isWebGpuAvailable()) {
      throw new Error('WEBGPU_UNAVAILABLE')
    }

    const id = requestId('load')
    const worker = this.ensureWorker()

    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        onProgress,
      })
      worker.postMessage({ type: 'load', requestId: id })
    })
  }

  async generate(system: string, task: string, maxNewTokens = 256): Promise<string> {
    if (!this.ready) {
      throw new Error('MODEL_NOT_READY')
    }

    const id = requestId('generate')
    const worker = this.ensureWorker()

    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(String(value ?? '')),
        reject,
      })
      worker.postMessage({
        type: 'generate',
        requestId: id,
        system,
        task,
        maxNewTokens,
      })
    })
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.ready = false
  }
}

export const localModelClient = new LocalModelClient()
