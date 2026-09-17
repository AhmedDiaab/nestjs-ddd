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
        const imports = getMetadata<object>('imports', AppModule);
        expect(imports).toEqual(
            expect.arrayContaining([InfrastructureModule, ApplicationModule, InterfaceModule]),
        );
    });

    it('registers the root controller', () => {
        const controllers = getMetadata<object>('controllers', AppModule);
        expect(controllers).toContain(AppController);
    });
});
