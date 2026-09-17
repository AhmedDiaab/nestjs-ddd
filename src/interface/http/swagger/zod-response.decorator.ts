import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ZodType } from 'zod';
import { toOpenApiSchema } from './zod-openapi';

/**
 * Documents a success response in the envelope ResponseFormatterInterceptor produces:
 * `{ success: true, data: <schema>, meta }`.
 *
 * @example @ZodResponse(200, ticketSummarySchema)
 */
export function ZodResponse(status: number, data: ZodType, description?: string): MethodDecorator {
    return applyDecorators(
        ApiResponse({
            status,
            description,
            schema: {
                type: 'object',
                required: ['success', 'data', 'meta'],
                properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: toOpenApiSchema(data, 'output'),
                    meta: {
                        type: 'object',
                        properties: {
                            timestamp: { type: 'string', format: 'date-time' },
                            path: { type: 'string' },
                            requestId: { type: 'string', nullable: true },
                        },
                    },
                },
            },
        }),
    );
}
