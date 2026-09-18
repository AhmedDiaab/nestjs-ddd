import {
    formatTraceparent,
    newSpanId,
    newTraceId,
    parseTraceparent,
    traceContextFrom,
} from '@shared';

const TRACE = 'a'.repeat(32);
const SPAN = 'b'.repeat(16);

describe('trace context', () => {
    describe('parseTraceparent', () => {
        it('reads a sampled header', () => {
            // Arrange
            const header = `00-${TRACE}-${SPAN}-01`;

            // Act
            const context = parseTraceparent(header);

            // Assert
            expect(context).toEqual({ traceId: TRACE, spanId: SPAN, sampled: true });
        });

        it('keeps an unsampled decision', () => {
            // Arrange
            const header = `00-${TRACE}-${SPAN}-00`;

            // Act
            const context = parseTraceparent(header);

            // Assert
            expect(context?.sampled).toBe(false);
        });

        it.each([
            ['nothing', undefined],
            ['free text', 'trace-me-please'],
            ['a short trace id', `00-${'a'.repeat(16)}-${SPAN}-01`],
            ['upper-case hex with padding', `  00-${'A'.repeat(31)}G-${SPAN}-01  `],
            ['the forbidden ff version', `ff-${TRACE}-${SPAN}-01`],
            ['an all-zero trace id', `00-${'0'.repeat(32)}-${SPAN}-01`],
            ['an all-zero span id', `00-${TRACE}-${'0'.repeat(16)}-01`],
        ])('ignores %s', (_name, header) => {
            // Arrange: a header from outside must not reach the logs unchecked

            // Act
            const context = parseTraceparent(header);

            // Assert
            expect(context).toBeUndefined();
        });

        it('accepts an upper-case header by normalising it', () => {
            // Arrange
            const header = `00-${TRACE.toUpperCase()}-${SPAN.toUpperCase()}-01`;

            // Act
            const context = parseTraceparent(header);

            // Assert
            expect(context?.traceId).toBe(TRACE);
        });
    });

    describe('traceContextFrom', () => {
        it('continues the caller’s trace with a span of its own', () => {
            // Arrange
            const header = `00-${TRACE}-${SPAN}-01`;

            // Act
            const context = traceContextFrom(header);

            // Assert
            expect(context.traceId).toBe(TRACE);
            expect(context.spanId).not.toBe(SPAN);
            expect(context.sampled).toBe(true);
        });

        it('starts a new trace when the caller sent none', () => {
            // Arrange: a request straight from a browser

            // Act
            const context = traceContextFrom(undefined);

            // Assert
            expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
            expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
            expect(context.sampled).toBe(true);
        });

        it('starts a new trace when the header is malformed, rather than trusting it', () => {
            // Arrange
            const header = '00-not-a-trace-01';

            // Act
            const context = traceContextFrom(header);

            // Assert
            expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
        });
    });

    describe('formatTraceparent', () => {
        it('round-trips through the parser', () => {
            // Arrange
            const context = { traceId: newTraceId(), spanId: newSpanId(), sampled: false };

            // Act
            const parsed = parseTraceparent(formatTraceparent(context));

            // Assert
            expect(parsed).toEqual(context);
        });
    });
});
