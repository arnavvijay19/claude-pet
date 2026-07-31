'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const BUILD_MODULE = '../scripts/build-provider-job-host.js';

function loadBuildModule() {
  try {
    return require(BUILD_MODULE);
  } catch (error) {
    assert.fail(`provider job host build module unavailable: ${error.code || error.message}`);
  }
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-job-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'provider-job-host.cs');
  const compilerPath = path.join(root, 'csc.exe');
  const outputDirectory = path.join(root, 'generated');
  fs.writeFileSync(sourcePath, 'source-v1\n', 'utf8');
  fs.writeFileSync(compilerPath, 'fixture compiler', 'utf8');
  return { root, sourcePath, compilerPath, outputDirectory };
}

function compilerOutputPath(args) {
  const option = args.find((argument) => /^\/out:/i.test(argument));
  return option ? option.slice('/out:'.length) : null;
}

function peMachine(filePath) {
  const executable = fs.readFileSync(filePath);
  assert.equal(executable.subarray(0, 2).toString('ascii'), 'MZ');
  const peOffset = executable.readUInt32LE(0x3c);
  assert.equal(executable.subarray(peOffset, peOffset + 4).toString('binary'), 'PE\0\0');
  return executable.readUInt16LE(peOffset + 4);
}

function successfulCompiler(command, args) {
  if (args.includes('/?')) {
    return {
      status: 0,
      stdout: 'Microsoft (R) Visual C# Compiler version 4.8.9232.0\r\n',
      stderr: '',
    };
  }
  const outputPath = compilerOutputPath(args);
  assert.ok(path.isAbsolute(command), 'compile invocation must use an absolute compiler path');
  assert.ok(outputPath, 'compile invocation must declare an output path');
  fs.writeFileSync(outputPath, 'compiled-v1', 'utf8');
  return { status: 0, stdout: '', stderr: '' };
}

function withPlatform(value, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...descriptor, value });
  try {
    return operation();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

test('build record binds protocol, source bytes, compiler, architecture, and executable bytes', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);

  const result = buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'architecture',
    'compilerPath',
    'compilerVersion',
    'executableSha256',
    'protocolVersion',
    'sourceSha256',
  ]);
  assert.deepEqual(result, {
    protocolVersion: 1,
    architecture: 'x64',
    compilerPath: fixture.compilerPath,
    compilerVersion: '4.8.9232.0',
    sourceSha256: '94e5c924e95943b5e0e9864d317ce4c60a19a7fcde49853435b7444c8920bfa7',
    executableSha256: '96cfb1ef47c6210f19b2f35b3359daf37669d135297cde9658103f32c4d34a21',
  });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(
      path.join(fixture.outputDirectory, 'provider-job-host.build.json'),
      'utf8',
    )),
    result,
  );
  assert.equal(
    fs.readFileSync(
      path.join(fixture.outputDirectory, 'provider-job-host.exe'),
      'utf8',
    ),
    'compiled-v1',
  );
});

test('an injected compiler keeps fake-compiler validation platform-neutral', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);

  const result = withPlatform('linux', () => buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  }));

  assert.equal(result.protocolVersion, 1);
  assert.equal(result.executableSha256, '96cfb1ef47c6210f19b2f35b3359daf37669d135297cde9658103f32c4d34a21');
});

test('compiler invocations and production candidates are exact and bounded', (t) => {
  const { buildProviderJobHost, defaultCompilerCandidates } = loadBuildModule();
  const fixture = createFixture(t);
  const calls = [];

  buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return successfulCompiler(command, args);
    },
  });

  assert.deepEqual(defaultCompilerCandidates('C:\\Windows'), [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ]);
  assert.equal(calls.length, 2);
  const expectedOptions = {
    cwd: path.dirname(fixture.compilerPath),
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  };
  assert.deepEqual(calls[0], {
    command: fixture.compilerPath,
    args: ['/?'],
    options: expectedOptions,
  });

  const stagedExecutable = compilerOutputPath(calls[1].args);
  const stagedSource = calls[1].args.at(-1);
  assert.equal(path.basename(stagedExecutable), 'provider-job-host.exe');
  assert.equal(path.basename(stagedSource), 'provider-job-host.cs');
  assert.equal(path.dirname(stagedExecutable), path.dirname(stagedSource));
  assert.match(path.basename(path.dirname(stagedExecutable)), /^\.build-/);
  assert.deepEqual(calls[1], {
    command: fixture.compilerPath,
    args: [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/optimize+',
      '/warnaserror+',
      '/utf8output',
      `/out:${stagedExecutable}`,
      stagedSource,
    ],
    options: expectedOptions,
  });
});

test('missing compiler and compiler warnings fail without replacing a previous good build', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);
  fs.mkdirSync(fixture.outputDirectory, { recursive: true });
  const executablePath = path.join(fixture.outputDirectory, 'provider-job-host.exe');
  const recordPath = path.join(fixture.outputDirectory, 'provider-job-host.build.json');
  fs.writeFileSync(executablePath, 'previous-executable', 'utf8');
  fs.writeFileSync(recordPath, '{"previous":true}\n', 'utf8');

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [],
      spawnSync: successfulCompiler,
    }),
    /provider helper compiler unavailable/i,
  );

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync(command, args) {
        if (args.includes('/?')) {
          return {
            status: 0,
            stdout: 'Microsoft (R) Visual C# Compiler version 4.8.9232.0\r\n',
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: 'warning CS9999: fixture warning' };
      },
    }),
    /provider helper compilation failed/i,
  );

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync(command, args) {
        if (args.includes('/?')) {
          return {
            status: 0,
            stdout: 'Microsoft (R) Visual C# Compiler version 4.8.9232.0\r\n',
            stderr: '',
          };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    }),
    /provider helper compilation failed/i,
  );

  assert.equal(fs.readFileSync(executablePath, 'utf8'), 'previous-executable');
  assert.equal(fs.readFileSync(recordPath, 'utf8'), '{"previous":true}\n');
});

test('compiler timeout and output overflow fail with fixed errors and preserve stale output', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);
  buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  });
  const executablePath = path.join(fixture.outputDirectory, 'provider-job-host.exe');
  const recordPath = path.join(fixture.outputDirectory, 'provider-job-host.build.json');
  const previousExecutable = fs.readFileSync(executablePath);
  const previousRecord = fs.readFileSync(recordPath);

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync() {
        return {
          status: null,
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('fixture compiler timed out'), { code: 'ETIMEDOUT' }),
        };
      },
    }),
    /^Error: Provider helper compiler unavailable$/,
  );

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync(command, args) {
        if (args.includes('/?')) return successfulCompiler(command, args);
        return {
          status: null,
          stdout: '',
          stderr: '',
          error: Object.assign(new Error('fixture compiler output overflowed'), { code: 'ENOBUFS' }),
        };
      },
    }),
    /^Error: Provider helper compilation failed$/,
  );

  assert.deepEqual(fs.readFileSync(executablePath), previousExecutable);
  assert.deepEqual(fs.readFileSync(recordPath), previousRecord);
});

test('a changed source during compilation cannot publish a mismatched build record', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);
  const first = buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  });
  const executablePath = path.join(fixture.outputDirectory, 'provider-job-host.exe');
  const recordPath = path.join(fixture.outputDirectory, 'provider-job-host.build.json');
  const previousExecutable = fs.readFileSync(executablePath);
  const previousRecord = fs.readFileSync(recordPath);

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync(command, args) {
        if (args.includes('/?')) return successfulCompiler(command, args);
        const result = successfulCompiler(command, args);
        fs.writeFileSync(fixture.sourcePath, 'source-v2\n', 'utf8');
        return result;
      },
    }),
    /provider helper source changed during compilation/i,
  );

  assert.deepEqual(fs.readFileSync(executablePath), previousExecutable);
  assert.deepEqual(fs.readFileSync(recordPath), previousRecord);
  assert.equal(first.sourceSha256, '94e5c924e95943b5e0e9864d317ce4c60a19a7fcde49853435b7444c8920bfa7');
});

test('a second generated-file rename failure restores the previous valid pair', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);
  buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  });
  const executablePath = path.join(fixture.outputDirectory, 'provider-job-host.exe');
  const recordPath = path.join(fixture.outputDirectory, 'provider-job-host.build.json');
  const previousExecutable = fs.readFileSync(executablePath);
  const previousRecord = fs.readFileSync(recordPath);
  let rejectedRecordInstall = false;

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync: successfulCompiler,
      renameSync(source, destination) {
        const isStagedRecord = path.basename(source) === 'provider-job-host.build.json'
          && path.dirname(source) !== fixture.outputDirectory;
        if (!rejectedRecordInstall && isStagedRecord && destination === recordPath) {
          rejectedRecordInstall = true;
          throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' });
        }
        fs.renameSync(source, destination);
      },
    }),
    /provider helper installation failed/i,
  );

  assert.equal(rejectedRecordInstall, true);
  assert.deepEqual(fs.readFileSync(executablePath), previousExecutable);
  assert.deepEqual(fs.readFileSync(recordPath), previousRecord);
});

test('a failed rollback preserves its recovery directory and previous backup bytes', (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const fixture = createFixture(t);
  buildProviderJobHost({
    sourcePath: fixture.sourcePath,
    outputDirectory: fixture.outputDirectory,
    compilerCandidates: [fixture.compilerPath],
    spawnSync: successfulCompiler,
  });
  const executablePath = path.join(fixture.outputDirectory, 'provider-job-host.exe');
  const recordPath = path.join(fixture.outputDirectory, 'provider-job-host.build.json');
  const previousExecutable = fs.readFileSync(executablePath);
  let rejectedRecordInstall = false;
  let rejectedExecutableRestore = false;

  assert.throws(
    () => buildProviderJobHost({
      sourcePath: fixture.sourcePath,
      outputDirectory: fixture.outputDirectory,
      compilerCandidates: [fixture.compilerPath],
      spawnSync: successfulCompiler,
      renameSync(source, destination) {
        const basename = path.basename(source);
        const isStagedRecord = basename === 'provider-job-host.build.json'
          && path.dirname(source) !== fixture.outputDirectory;
        if (!rejectedRecordInstall && isStagedRecord && destination === recordPath) {
          rejectedRecordInstall = true;
          throw Object.assign(new Error('fixture record install denied'), { code: 'EACCES' });
        }
        if (basename === 'provider-job-host.exe.previous' && destination === executablePath) {
          rejectedExecutableRestore = true;
          throw Object.assign(new Error('fixture executable restore denied'), { code: 'EACCES' });
        }
        fs.renameSync(source, destination);
      },
    }),
    /provider helper installation failed/i,
  );

  assert.equal(rejectedRecordInstall, true);
  assert.equal(rejectedExecutableRestore, true);
  const recoveryDirectories = fs.readdirSync(fixture.outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.build-'));
  assert.equal(recoveryDirectories.length, 1);
  const recoveryExecutable = path.join(
    fixture.outputDirectory,
    recoveryDirectories[0].name,
    'provider-job-host.exe.previous',
  );
  assert.deepEqual(fs.readFileSync(recoveryExecutable), previousExecutable);
});

test('real Windows helper uses the portable loader and preserves command contracts', {
  skip: process.platform !== 'win32',
}, (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-real-job-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputDirectory = path.join(root, 'generated');

  buildProviderJobHost({ outputDirectory });
  const executable = path.join(outputDirectory, 'provider-job-host.exe');
  const protocol = childProcess.spawnSync(executable, ['--protocol-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const unsupported = childProcess.spawnSync(executable, ['--unsupported'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(peMachine(executable), 0x014c);
  assert.equal(protocol.status, 0);
  assert.match(protocol.stdout, /^1\r?\n$/);
  assert.equal(protocol.stderr, '');
  assert.equal(unsupported.status, 64);
  assert.equal(unsupported.stdout, '');
  assert.equal(unsupported.stderr, '');
});

test('helper source refuses protocol execution in a 32-bit process', {
  skip: process.platform !== 'win32',
}, (t) => {
  const { buildProviderJobHost } = loadBuildModule();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pet-x86-job-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const record = buildProviderJobHost({ outputDirectory: path.join(root, 'generated') });
  const x86Executable = path.join(root, 'provider-job-host-x86.exe');
  const x86Compile = childProcess.spawnSync(record.compilerPath, [
    '/nologo',
    '/target:exe',
    '/platform:x86',
    '/optimize+',
    '/warnaserror+',
    '/utf8output',
    `/out:${x86Executable}`,
    path.resolve(__dirname, '..', 'resources', 'windows', 'provider-job-host.cs'),
  ], {
    cwd: path.dirname(record.compilerPath),
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(x86Compile.status, 0);
  assert.equal(x86Compile.stdout, '');
  assert.equal(x86Compile.stderr, '');

  const x86Protocol = childProcess.spawnSync(x86Executable, ['--protocol-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(x86Protocol.status, 64);
  assert.equal(x86Protocol.stdout, '');
  assert.equal(x86Protocol.stderr, '');
});
