import {
    DatabaseInfoRepositoryPortToken,
    type DatabaseInfo,
    type DatabaseInfoRepositoryPort,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = {
    /** Authenticated username; forwarded to the database as CLIENT_IDENTIFIER. */
    username?: string;
};

type Output = DatabaseInfo;

/**
 * Example use case. Convention:
 * - expected business failures → `this.err(new SomeAppError())` (mapped to HTTP status by the interface layer)
 * - unexpected failures → throw
 */
@Injectable()
export class GetDatabaseInfoUseCase extends UseCase<Input, Output, never> {
    constructor(
        @Inject(DatabaseInfoRepositoryPortToken)
        private readonly repository: DatabaseInfoRepositoryPort,
    ) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, never>> {
        const info = await this.repository.getInfo(input.username);
        return this.ok(info);
    }
}
