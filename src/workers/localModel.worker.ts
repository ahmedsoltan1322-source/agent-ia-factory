/// <reference lib="webworker" />

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

// Official WebLLM worker boundary: all heavy model execution stays off the UI
// thread. The main thread talks to this handler through WebLLM's typed engine.
const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event)
}
