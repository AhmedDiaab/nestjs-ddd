import { type Result } from '@shared/result';
import { type Awaitable } from '@shared/type-utils';

export interface IUseCase<Input, Output, Error = never> {
    execute(input: Input): Awaitable<Result<Output, Error>>;
}

// Symantic aliases, no functional difference
export type ICommandUseCase<Input, Output = void, Error = never> = IUseCase<Input, Output, Error>;

export type IQueryUseCase<Input, Output, Error = never> = IUseCase<Input, Output, Error>;

export const UC_Token = (name: string) => Symbol.for(`UseCase:${name}>`);
