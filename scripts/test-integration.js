// Backward-compatible entry; all isolation logic lives in run-suite.js.
process.argv[2] = 'integration';
await import('./run-suite.js');
