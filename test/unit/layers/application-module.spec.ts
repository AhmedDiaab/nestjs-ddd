import 'reflect-metadata';
import { ApplicationModule } from '@application';
import { DomainEventPublisherPortToken } from '@application/ports';

describe('ApplicationModule composition', () => {
    it('provides and exports the domain event publisher', () => {
        // Arrange
        const exports = (Reflect.getMetadata('exports', ApplicationModule) as unknown[]) ?? [];

        // Act
        const exported = exports.includes(DomainEventPublisherPortToken);

        // Assert
        expect(exported).toBe(true);
    });

    it('imports no other module (ports come from global infrastructure modules)', () => {
        // Arrange: ApplicationModule metadata

        // Act
        const imports = (Reflect.getMetadata('imports', ApplicationModule) as unknown[]) ?? [];

        // Assert
        expect(imports).toEqual([]);
    });
});
