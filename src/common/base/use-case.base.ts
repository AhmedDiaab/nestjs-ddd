import type { IUseCase } from '@common/contracts/use-case';
import { Result, type Err, type Ok } from '@shared';

export abstract class UseCase<Input, Output, Error> implements IUseCase<Input, Output, Error> {
    abstract execute(input: Input): Promise<Result<Output, Error>>;

    protected ok(value: Output): Ok<Output> {
        return Result.ok(value);
    }

    protected err(error: Error): Err<Error> {
        return Result.err(error);
    }
}
