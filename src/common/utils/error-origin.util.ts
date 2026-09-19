/**
 * Finds the single stack frame that points at OUR code — the line worth logging — instead of a
 * full stack trace or, worse, the top frame, which for a driver/library error is almost always
 * inside `node_modules` or a `node:` internal. Framework-free: no NestJS, no infrastructure
 * imports. Used by the logging layer to attach a precise `origin` (and `causeOrigin`) to every
 * error log line, always on, independent of `SHOW_STACK_TRACES`.
 */

/**
 * `/test/` is here so an error thrown inside a spec still names its line; a stack that passes
 * through both is unaffected, since the scan is top-down and application frames sit above the
 * spec that called them. Production stacks never contain `/test/`.
 */
const OWN_PATH_MARKERS = ['/src/', '/dist/', '/test/'] as const;
const MAX_CAUSE_DEPTH = 10;

interface ParsedFrame {
    fn?: string;
    location: string;
}

/** V8 frame lines start with `at `, either `at Fn (path:line:col)` or `at path:line:col`. */
function parseFrame(rawLine: string): ParsedFrame | undefined {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) return undefined;

    const rest = line.slice(3).trim();
    const withFunction = rest.match(/^(.*)\s\((.*)\)$/);
    if (withFunction) {
        const fn = withFunction[1].trim();
        const location = withFunction[2].trim();
        return fn ? { fn, location } : { location };
    }
    return { location: rest };
}

/** Ours: inside the project (`/src/` or `/dist/`), never `node_modules`, never a `node:` internal. */
function isOwnFrame(location: string): boolean {
    if (location.startsWith('node:')) return false;
    if (location.includes('node_modules')) return false;
    return OWN_PATH_MARKERS.some((marker) => location.includes(marker));
}

/** Drops the machine-specific prefix, keeping the path from `src/` or `dist/` onward. */
function relativeToProject(location: string): string | undefined {
    for (const marker of OWN_PATH_MARKERS) {
        const index = location.indexOf(marker);
        if (index !== -1) return location.slice(index + 1);
    }
    return undefined;
}

/** `path:line:col` -> `path:line`; the column adds noise without helping a reader. */
function stripColumn(location: string): string {
    const match = location.match(/^(.*):(\d+):(\d+)$/);
    return match ? `${match[1]}:${match[2]}` : location;
}

/** Scans every frame top-down — the first one is often a dependency, never a dead end. */
function frameFromStack(stack: string | undefined): string | undefined {
    if (!stack) return undefined;

    for (const rawLine of stack.split('\n')) {
        const parsed = parseFrame(rawLine);
        if (!parsed || !isOwnFrame(parsed.location)) continue;

        const relative = relativeToProject(parsed.location);
        if (!relative) continue;

        const location = stripColumn(relative);
        return parsed.fn ? `${location} (${parsed.fn})` : location;
    }
    return undefined;
}

function stackOf(error: unknown): string | undefined {
    if (error instanceof Error) return error.stack;
    if (typeof error === 'object' && error !== null && 'stack' in error) {
        const stack = (error as { stack?: unknown }).stack;
        return typeof stack === 'string' ? stack : undefined;
    }
    return undefined;
}

function causeOf(error: unknown): unknown {
    if (typeof error === 'object' && error !== null && 'cause' in error) {
        return (error as { cause?: unknown }).cause;
    }
    return undefined;
}

function isTraversable(value: unknown): value is object {
    return typeof value === 'object' && value !== null;
}

/**
 * The frame of OUR code that created `error`: scans its own stack top-down for the first frame
 * of ours, then follows `cause` until one is found. `undefined` when nothing in the chain has a
 * single frame of ours — never invented.
 */
export function errorOrigin(error: unknown): string | undefined {
    return resolveErrorOrigin(error).origin;
}

export interface ErrorOrigin {
    /** The outermost error in the `cause` chain that has an app frame. */
    origin?: string;
    /** A different app frame found further down the `cause` chain, when one exists. */
    causeOrigin?: string;
}

/**
 * `origin` and `causeOrigin` for an error and its `cause` chain (`DatabaseExecutionError`,
 * `InfrastructureError`, `UnexpectedError`, …). Guards a cyclic chain with an identity set and a
 * depth cap, so a self-referential `cause` can never loop.
 */
export function resolveErrorOrigin(error: unknown): ErrorOrigin {
    const seen = new Set<unknown>();
    let current: unknown = error;
    let depth = 0;
    let origin: string | undefined;

    while (isTraversable(current) && depth < MAX_CAUSE_DEPTH && !seen.has(current)) {
        seen.add(current);
        depth++;
        const frame = frameFromStack(stackOf(current));
        if (frame) {
            origin = frame;
            current = causeOf(current);
            break;
        }
        current = causeOf(current);
    }

    if (!origin) return {};

    let causeOrigin: string | undefined;
    while (isTraversable(current) && depth < MAX_CAUSE_DEPTH && !seen.has(current)) {
        seen.add(current);
        depth++;
        const frame = frameFromStack(stackOf(current));
        if (frame && frame !== origin) {
            causeOrigin = frame;
            break;
        }
        current = causeOf(current);
    }

    return causeOrigin ? { origin, causeOrigin } : { origin };
}
