import type { Config } from 'jest';

const config: Config = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testMatch: ['<rootDir>/test/**/*.spec.ts'],
    transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
    },
    collectCoverageFrom: ['src/**/*.(t|j)s'],
    collectCoverage: false,
    coverageDirectory: 'coverage',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^@application$': '<rootDir>/src/application/index',
        '^@application/(.*)$': '<rootDir>/src/application/$1',
        '^@infrastructure$': '<rootDir>/src/infrastructure/index',
        '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
        '^@domain$': '<rootDir>/src/domain/index',
        '^@domain/(.*)$': '<rootDir>/src/domain/$1',
        '^@interface$': '<rootDir>/src/interface/index',
        '^@interface/(.*)$': '<rootDir>/src/interface/$1',
        '^@common$': '<rootDir>/src/common/index',
        '^@common/(.*)$': '<rootDir>/src/common/$1',
        '^@shared$': '<rootDir>/src/shared/index',
        '^@shared/(.*)$': '<rootDir>/src/shared/$1',
        '^@src$': '<rootDir>/src',
        '^@src/(.*)$': '<rootDir>/src/$1',
        '^@mocks/(.*)$': '<rootDir>/test/mocks/$1',
    },
    coveragePathIgnorePatterns: ['main.ts', 'repl.ts', 'src/common/(base|contracts)/*'],
    // floor, not a target: raise it when coverage rises, never lower it to make a change pass
    coverageThreshold: {
        global: { statements: 85, branches: 70, functions: 71, lines: 85 },
    },
};

export default config;
