/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers'

const MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'
const MODEL_DTYPE = 'q4f16'

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type TextGenerationOptions = {
  max_new_tokens: number
  do_sample: boolean
}

type TextGenerator = (
  messages: ChatMessage[],
  options: TextGenerationOptions,
) => Promise<unknown>

let generator: TextGenerator | null = null
let loading: Promise<TextGenerator> | null = null

type LoadMessage = {
  type: 'load'
  requestId: string
}

type GenerateMessage = {
  type: 'generate'
  requestId: string
  system: string
  task: string
  maxNewTokens: number
}

type WorkerRequest = LoadMessage | GenerateMessage

function post(type: string, payload: Record<string, unknown>) {
  self.postMessage({ type, ...payload })
}

function webGpuAvailable(): boolean {
  return Boolean((self.navigator as WorkerNavigator & { gpu?: unknown }).gpu)
}

async function ensureModel(requestId: string): Promise<TextGenerator> {
  if (generator) return generator
  if (!webGpuAvailable()) {
    throw new Error('WEBGPU_UNAVAILABLE')
  }

  if (!loading) {
    loading = pipeline('text-generation', MODEL_ID, {
      device: 'webgpu',
      dtype: MODEL_DTYPE,
      progress_callback: (progress: unknown) => {
        post('progress', { requestId, progress })
      },
    }).then((loaded) => {
      // Transformers.js exposes a broad union type for pipeline(), while this
      // worker intentionally requests only text-generation. Keep that
      // narrowing at this adapter boundary so the rest of Agent Core stays
      // independent from the library's pipeline type union.
      const textGenerator = loaded as unknown as TextGenerator
      generator = textGenerator
      return textGenerator
    }).finally(() => {
      loading = null
    })
  }

  return loading
}

function extractText(output: unknown): string {
  if (!Array.isArray(output) || output.length === 0) {
    return String(output ?? '')
  }

  const first = output[0] as { generated_text?: unknown }
  const generated = first.generated_text

  if (typeof generated === 'string') {
    return generated
  }

  if (Array.isArray(generated) && generated.length > 0) {
    const last = generated[generated.length - 1] as { content?: unknown }
    if (typeof last?.content === 'string') {
      return last.content
    }
  }

  return JSON.stringify(output)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  try {
    if (message.type === 'load') {
      await ensureModel(message.requestId)
      post('ready', {
        requestId: message.requestId,
        modelId: MODEL_ID,
        dtype: MODEL_DTYPE,
      })
      return
    }

    if (message.type === 'generate') {
      if (!generator) {
        throw new Error('MODEL_NOT_READY')
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: message.system },
        { role: 'user', content: message.task },
      ]

      const output = await generator(messages, {
        max_new_tokens: message.maxNewTokens,
        do_sample: false,
      })

      post('result', {
        requestId: message.requestId,
        text: extractText(output),
      })
    }
  } catch (error) {
    post('error', {
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
