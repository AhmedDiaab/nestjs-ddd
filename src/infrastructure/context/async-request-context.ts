import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext, RequestContextPort } from '@application/ports';

/**
 * Request context carried through async calls without passing it argument by argument.
 *
 * Only for cross-cutting values (the correlation id). The acting user stays explicit:
 * controllers pass `username` into the use case and adapters send it as `contextUser`,
 * so an audit trail never depends on ambient state.
 */
export class AsyncRequestContext implements RequestContextPort {
    private readonly storage = new AsyncLocalStorage<RequestContext>();

    run<T>(context: RequestContext, fn: () => T): T {
        return this.storage.run(context, fn);
    }

    get(): RequestContext | undefined {
        return this.storage.getStore();
    }
}
