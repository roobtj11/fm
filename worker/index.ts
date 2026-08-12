interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
}

const worker = {
    async fetch(_request: Request, _env: unknown, _ctx: ExecutionContext): Promise<Response> {
        return new Response('Not found', { status: 404 })
    },
}

export default worker
