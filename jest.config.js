/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
      // Runs after the test framework is installed in the environment
      setupFilesAfterEnv: ['<rootDir>/tests/setup.js', '@testing-library/jest-dom'],
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/e2e/**/*.spec.js'],
    },
  ],
  // Source files are loaded via require() in tests, so Istanbul instruments
  // them for coverage. content_script.js is excluded because it's an
  // orchestrator tested via e2e, not unit tests.
  collectCoverageFrom: ['src/**/*.js', '!src/content_script.js'],
};

module.exports = config;
