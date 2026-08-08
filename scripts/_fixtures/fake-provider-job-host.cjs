'use strict';

// scripts/_fixtures/fake-provider-job-host.cjs
//
// Test double for resources/windows/generated/provider-job-host.exe. It mirrors the exact
// adapter contract so tests can run without the (unbuilt) C# helper:
//   * reads one framed JSON launch envelope line from stdin
//   * writes the readiness frame `CLAUDE_PET_JOB_READY 1\r\n` to stderr
//   * writes a provider-stderr marker to stderr
//   * proxies subsequent stdin -> provider stdout
//   * exits 0 when stdin reaches EOF
//
// It never forwards the envelope line to provider stdout, matching the real helper, which
// consumes the envelope itself. Two environment switches exercise the adapter's failure paths:
//   FAKE_HELPER_WRONG=1  -> emit a malformed readiness frame
//   FAKE_HELPER_SILENT=1 -> emit no readiness frame at all (hang until killed)

const stdin = process.stdin;
const stdout = process.stdout;
const stderr = process.stderr;

const READY = 'CLAUDE_PET_JOB_READY 1\r\n';
const PROVIDER_STDERR = 'provider-stderr\r\n';

stdin.resume();
let buffer = '';
let ready = false;

function emitReady() {
  if (ready) return;
  ready = true;
  stderr.write(READY);
  stderr.write(PROVIDER_STDERR);
}

stdin.on('data', (chunk) => {
  if (process.env.FAKE_HELPER_SILENT === '1') return; // never emit readiness
  const text = chunk.toString('utf8');
  if (!ready) {
    buffer += text;
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;

    if (process.env.FAKE_HELPER_WRONG === '1') {
      ready = true;
      stderr.write('CLAUDE_PET_JOB_WRONG 1\r\n');
      return;
    }

    const line = buffer.slice(0, newline);
    const rest = buffer.slice(newline + 1);
    buffer = '';
    try {
      const parsed = JSON.parse(line);
      if (!parsed || parsed.protocolVersion !== 1) {
        ready = true;
        stderr.write(`CLAUDE_PET_JOB_WRONG ${parsed && parsed.protocolVersion}\r\n`);
        return;
      }
    } catch (err) {
      ready = true;
      stderr.write('CLAUDE_PET_JOB_WRONG 0\r\n');
      return;
    }
    emitReady();
    if (rest.length > 0) stdout.write(rest);
    return;
  }
  stdout.write(text);
});

function finish() {
  emitReady();
  stdout.end();
  stderr.end();
  process.exit(0);
}

stdin.on('end', finish);
stdin.on('error', () => process.exit(1));
