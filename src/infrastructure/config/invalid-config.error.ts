/** Startup configuration failed validation. Lists paths and messages only, never values. */
export class InvalidConfigError extends Error {
    constructor(public readonly issues: { path: string; code: string; message: string }[]) {
        super(
            `Invalid configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
        );
        this.name = 'InvalidConfigError';
    }
}
