export interface ConfigPort {
    isDevelopment(): boolean;
    isProduction(): boolean;
    get<T = string | number>(key: string): T | undefined;
    all(): Record<string, unknown>;
}
