export interface ConfigPort {
    isDevelopment(): boolean;
    get<T = string | number>(key: string): T | undefined;
    all(): Record<string, unknown>;
}
