import { Deprecated, DEPRECATION_METADATA } from '@interface/http/decorators/deprecated.decorator';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

@Controller('deprecation-probe')
class DeprecationProbeController {
    @Get()
    @Deprecated({ since: '2026-01-01', sunset: '2026-12-31', note: 'Use v2 instead.' })
    list(this: void) {
        return [];
    }
}

describe('Deprecated', () => {
    it('throws on a bad date without ever being applied to a class', () => {
        // Arrange
        const act = () => Deprecated({ since: 'not-a-date', sunset: '2026-12-31' });

        // Act & Assert
        expect(act).toThrow(Error);
    });

    it('treats successor, link and note as optional', () => {
        // Arrange
        const act = () => Deprecated({ since: '2026-01-01', sunset: '2026-12-31' });

        // Act & Assert
        expect(act).not.toThrow();
    });

    it('stores the formatted headers, not the raw options, under DEPRECATION_METADATA', () => {
        // Arrange: DeprecationProbeController.list carries @Deprecated({ since, sunset, note })

        // Act
        const metadata: unknown = Reflect.getMetadata(
            DEPRECATION_METADATA,
            DeprecationProbeController.prototype.list,
        );

        // Assert
        expect(metadata).toEqual({
            Deprecation: `@${Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)}`,
            Sunset: new Date('2026-12-31T00:00:00Z').toUTCString(),
        });
    });

    describe('Swagger document', () => {
        let app: INestApplication;
        let document: OpenAPIObject;

        beforeAll(async () => {
            const moduleRef = await Test.createTestingModule({
                controllers: [DeprecationProbeController],
            }).compile();
            app = moduleRef.createNestApplication();
            await app.init();
            document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
        });

        afterAll(() => app.close());

        it('marks the operation deprecated: true', () => {
            // Arrange: DeprecationProbeController.list carries @Deprecated(...)

            // Act
            const operation = document.paths['/deprecation-probe'].get;

            // Assert
            expect(operation?.deprecated).toBe(true);
        });

        it('mentions the sunset date in the generated description', () => {
            // Arrange: DeprecationProbeController.list carries @Deprecated(...)

            // Act
            const operation = document.paths['/deprecation-probe'].get;

            // Assert
            expect(operation?.description).toContain('2026-12-31');
        });
    });
});
