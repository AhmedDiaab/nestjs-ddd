import { applyDecorators } from '@nestjs/common';
import {
    ApiBody,
    ApiHeader,
    ApiParam,
    ApiQuery,
    ApiResponse,
    type SchemaObject,
} from '@nestjs/swagger';
import { z, type ZodType } from 'zod';

type Parts = { body?: ZodType; query?: ZodType; params?: ZodType; headers?: ZodType };

/** OpenAPI 3.0 schema of what a client sends (input side: before defaults/coercion). */
export function toOpenApiSchema(schema: ZodType, io: 'input' | 'output' = 'input'): SchemaObject {
    const json = z.toJSONSchema(schema, {
        target: 'openapi-3.0',
        io,
        unrepresentable: 'any',
    }) as SchemaObject & { $schema?: string };
    delete json.$schema; // JSON Schema dialect marker, not valid inside an OpenAPI document
    return json;
}

function objectProperties(schema: ZodType): [string, SchemaObject, boolean][] {
    const json = toOpenApiSchema(schema);
    const required = new Set(json.required ?? []);
    return Object.entries(json.properties ?? {}).map(([name, property]) => [
        name,
        property as SchemaObject,
        required.has(name),
    ]);
}

/** Swagger decorators derived from the route's Zod schemas, so docs can't drift from validation. */
export function zodRequestDocs(parts: Parts): MethodDecorator[] {
    const decorators: MethodDecorator[] = [];
    if (parts.body) decorators.push(ApiBody({ schema: toOpenApiSchema(parts.body) }));
    for (const [name, schema, required] of parts.query ? objectProperties(parts.query) : []) {
        decorators.push(ApiQuery({ name, schema, required, description: schema.description }));
    }
    for (const [name, schema] of parts.params ? objectProperties(parts.params) : []) {
        decorators.push(
            ApiParam({ name, schema, required: true, description: schema.description }),
        );
    }
    for (const [name, schema, required] of parts.headers ? objectProperties(parts.headers) : []) {
        decorators.push(ApiHeader({ name, schema, required, description: schema.description }));
    }
    return decorators;
}

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
