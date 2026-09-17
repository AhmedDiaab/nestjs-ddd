import { ApplicationModule } from '@application';
import { InfrastructureModule } from '@infrastructure';
import { InterfaceModule, SchedulerModule } from '@interface';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

/**
 * Composition root: the only place where layers are wired together.
 * Infrastructure provides port implementations (global), application provides use cases,
 * interface exposes them. Layers never import each other's Nest modules.
 */
@Module({
    imports: [InfrastructureModule, ApplicationModule, InterfaceModule, SchedulerModule],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
