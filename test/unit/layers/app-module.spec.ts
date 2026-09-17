import 'reflect-metadata';
import { ApplicationModule } from '@application';
import { InfrastructureModule } from '@infrastructure/infrastructure.module';
import { InterfaceModule } from '@interface/interface.module';
import { AppController } from '@src/app.controller';
import { AppModule } from '@src/app.module';

jest.mock('dotenv-flow/config', () => undefined);

const getMetadata = <T>(key: string, target: object): T[] => {
    return (Reflect.getMetadata(key, target) as T[]) ?? [];
};

describe('AppModule layering', () => {
    it('is the composition root for all layers', () => {
        // Arrange
        const layers = [InfrastructureModule, ApplicationModule, InterfaceModule];

        // Act
        const imports = getMetadata<object>('imports', AppModule);

        // Assert
        expect(imports).toEqual(expect.arrayContaining(layers));
    });

    it('registers the root controller', () => {
        // Arrange: AppModule metadata

        // Act
        const controllers = getMetadata<object>('controllers', AppModule);

        // Assert
        expect(controllers).toContain(AppController);
    });
});
