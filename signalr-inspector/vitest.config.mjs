import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      enabled: false,
      provider: 'v8',
      // The vm/jsdom-eval runtime adapters are covered behaviorally but are not visible to V8.
      include: [
        'activation.js',
        'contentScript.js',
        'longPolling.js',
        'msgpackDecoder.js',
        'signalrAnalysis.js',
        'signalrProtocol.js',
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 90,
        lines: 85,
        'contentScript.js': {
          branches: 90,
        },
        'msgpackDecoder.js': {
          branches: 80,
        },
      },
    },
  },
});
