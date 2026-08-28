import type {
  InitProgressReport,
  MLCEngineInterface,
} from '../vendor/webllm'

export type LocalModelState = 'idle' | 'loading' | 'ready' | 'error'

export interface LocalModelProgress {
  status?: string
  progress?: number
}

type ProgressListener = (progress: LocalModelProgress) => void

const MODEL_ID = 'Qwen3-0.6B-q4f16_1-MLC'

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { gpu?: unknown }).gpu)
}

export class LocalModelClient {
  private worker: Worker | null = null
  private engine: MLCEngineInterface | null = null
  private loading: Promise<void> | null = null

  isReady(): boolean {
    return this.engine !== null
  }

  private createWorker(): Worker {
    return new Worker(new URL('../workers/localModel.worker.ts', import.meta.url), {
      type: 'module',
    })
  }

  async load(onProgress?: ProgressListener): Promise<void> {
    if (this.engine) return
    if (!isWebGpuAvailable()) {
      throw new Error('WEBGPU_UNAVAILABLE')
    }
    if (this.loading) return this.loading

    this.loading = (async () => {
      // Do not put WebLLM in the app's initial JavaScript bundle. This dynamic
      // import happens only after the user explicitly requests Local AI.
      const { CreateWebWorkerMLCEngine } = await import('../vendor/webllm')
      const worker = this.createWorker()
      this.worker = worker

      try {
        const initProgressCallback = (report: InitProgressReport) => {
          onProgress?.({
            status: report.text,
            progress: Math.max(0, Math.min(100, report.progress * 100)),
          })
        }

        this.engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, {
          initProgressCallback,
        })
      } catch (error) {
        worker.terminate()
        this.worker = null
        this.engine = null
        throw error
      } finally {
        this.loading = null
      }
    })()

    return this.loading
  }

  async generate(system: string, task: string, maxNewTokens = 256): Promise<string> {
    if (!this.engine) {
      throw new Error('MODEL_NOT_READY')
    }

    const reply = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: task },
      ],
      temperature: 0.2,
      max_tokens: maxNewTokens,
      stream: false,
    })

    const content = reply.choices[0]?.message?.content
    return typeof content === 'string' ? content : String(content ?? '')
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.engine = null
    this.loading = null
  }
}

export const localModelClient = new LocalModelClient()
