import { UseZodHttp, ZOD_HTTP_SCHEMA } from '@interface/http/decorators';
import { ZodResponse } from '@interface/http/swagger';
import { Body, Controller, Get, Param, Post, Query, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    status: z.enum(['open', 'closed']).optional().describe('Filter by status'),
});
const idParams = z.object({ id: z.uuid() });
const openBody = z.object({ title: z.string().min(1).max(200) });
const summary = z.object({ id: z.uuid(), title: z.string() });

@UseZodHttp({ headers: z.object({ 'x-tenant': z.string() }) })
@Controller('probe')
class ProbeController {
    @Get()
    @UseZodHttp({ query: listQuery })
    list(@Query() query: unknown) {
        return query;
    }

    @Get(':id')
    @UseZodHttp({ params: idParams })
    @ZodResponse(200, summary)
    get(@Param() params: unknown) {
        return params;
    }

    @Post()
    @UseZodHttp({ body: openBody })
    open(@Body() body: unknown) {
        return body;
    }
}

describe('Swagger from Zod schemas', () => {
    let app: INestApplication;
    let document: OpenAPIObject;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [ProbeController],
        }).compile();
        app = moduleRef.createNestApplication();
        await app.init();
        document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    });

    afterAll(() => app.close());

    type Parameter = {
        name: string;
        in: string;
        required?: boolean;
        description?: string;
        schema?: object;
    };
    const parametersOf = (path: string) =>
        (document.paths[path].get?.parameters ?? []) as Parameter[];

    it('documents query properties with their constraints and required flags', () => {
        // Arrange: ProbeController.list uses listQuery

        // Act
        const parameters = parametersOf('/probe');

        // Assert
        expect(parameters.find((p) => p.name === 'page')).toMatchObject({
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 1 },
        });
        expect(parameters.find((p) => p.name === 'status')).toMatchObject({
            in: 'query',
            required: false,
            description: 'Filter by status',
            schema: { enum: ['open', 'closed'] },
        });
    });

    it('documents path params', () => {
        // Arrange: ProbeController.get uses idParams

        // Act
        const parameters = parametersOf('/probe/{id}');

        // Assert
        expect(parameters).toHaveLength(1);
        expect(parameters[0]).toMatchObject({
            name: 'id',
            in: 'path',
            required: true,
            schema: { format: 'uuid' },
        });
    });

    it('documents the request body', () => {
        // Arrange: ProbeController.open uses openBody

        // Act
        const body = document.paths['/probe'].post?.requestBody;

        // Assert
        expect(body).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        type: 'object',
                        required: ['title'],
                        properties: { title: { type: 'string', minLength: 1, maxLength: 200 } },
                    },
                },
            },
        });
    });

    it('documents responses inside the success envelope', () => {
        // Arrange: ProbeController.get declares @ZodResponse(200, summary)

        // Act
        const response = document.paths['/probe/{id}'].get?.responses['200'];

        // Assert
        expect(response).toMatchObject({
            content: {
                'application/json': {
                    schema: {
                        properties: {
                            success: { enum: [true] },
                            data: {
                                properties: { id: { format: 'uuid' }, title: { type: 'string' } },
                            },
                        },
                    },
                },
            },
        });
    });

    it('still stores class-level schemas as metadata for validation', () => {
        // Arrange: ProbeController has a class-level headers schema

        // Act
        const metadata = Reflect.getMetadata(ZOD_HTTP_SCHEMA, ProbeController) as {
            headers?: unknown;
        };

        // Assert
        expect(metadata.headers).toBeDefined();
    });
});
