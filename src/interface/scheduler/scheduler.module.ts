import { ApplicationModule } from '@application';
import { ProviderFactory } from '@common/factories';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JobScheduler } from './job-scheduler';
import { ScheduledJobsToken, type ScheduledJob } from './scheduled-job';

/** Job classes of this service; add each new job here (they are also listed in `providers`). */
const jobs: (new (...args: never[]) => ScheduledJob)[] = [];

@Module({
    imports: [ApplicationModule, ScheduleModule.forRoot()],
    providers: [
        ...jobs,
        ProviderFactory.factory(ScheduledJobsToken, (...list: ScheduledJob[]) => list, jobs),
        JobScheduler,
    ],
})
export class SchedulerModule {}
