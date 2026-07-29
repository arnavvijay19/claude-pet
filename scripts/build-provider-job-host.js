'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_VERSION = 1;
const OUTPUT_NAMES = Object.freeze({
  executable: 'provider-job-host.exe',
  record: 'provider-job-host.build.json',
});
const COMPILER_VERSION_PATTERN = /Visual C# Compiler version ([0-9]+(?:\.[0-9]+){2,3})/;
const PRESERVE_RECOVERY_DIRECTORY = Symbol('preserveRecoveryDirectory');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function defaultCompilerCandidates(systemRoot = (
  process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR
)) {
  if (typeof systemRoot !== 'string' || !path.win32.isAbsolute(systemRoot)
      || systemRoot.includes('\0')) return [];
  const root = path.win32.normalize(systemRoot);
  return [
    path.win32.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.win32.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
}

function resolveCompiler(candidates) {
  if (!Array.isArray(candidates)) throw new Error('Provider helper compiler unavailable');
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)
        || candidate.includes('\0') || path.basename(candidate).toLowerCase() !== 'csc.exe') {
      continue;
    }
    try {
      if (fs.statSync(candidate).isFile()) return path.normalize(candidate);
    } catch {
      // Continue only through the caller-provided allowlist.
    }
  }
  throw new Error('Provider helper compiler unavailable');
}

function spawnCompiler(spawnSync, compilerPath, args) {
  let result;
  try {
    result = spawnSync(compilerPath, args, {
      cwd: path.dirname(compilerPath),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error('Provider helper compilation failed', { cause: error });
  }
  if (!result || result.error || result.status !== 0) {
    throw new Error('Provider helper compilation failed', { cause: result?.error });
  }
  return {
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function readCompilerVersion(spawnSync, compilerPath) {
  const result = spawnCompiler(spawnSync, compilerPath, ['/?']);
  if (result.stderr.trim() !== '') throw new Error('Provider helper compiler unavailable');
  const match = COMPILER_VERSION_PATTERN.exec(result.stdout);
  if (!match) throw new Error('Provider helper compiler unavailable');
  return match[1];
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative);
}

function existingRegularFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Provider helper generated path is not a regular file');
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function installGeneratedPair({
  stagedExecutable,
  stagedRecord,
  executablePath,
  recordPath,
  temporaryDirectory,
  outputDirectory,
  renameSync,
}) {
  const backupExecutable = path.join(temporaryDirectory, `${OUTPUT_NAMES.executable}.previous`);
  const backupRecord = path.join(temporaryDirectory, `${OUTPUT_NAMES.record}.previous`);
  for (const candidate of [
    stagedExecutable,
    stagedRecord,
    executablePath,
    recordPath,
    backupExecutable,
    backupRecord,
  ]) {
    if (!isWithin(outputDirectory, candidate)) {
      throw new Error('Provider helper output path escaped its directory');
    }
  }
  const hadExecutable = existingRegularFile(executablePath);
  const hadRecord = existingRegularFile(recordPath);
  let backedUpExecutable = false;
  let backedUpRecord = false;
  let installedExecutable = false;
  let installedRecord = false;
  try {
    if (hadExecutable) {
      renameSync(executablePath, backupExecutable);
      backedUpExecutable = true;
    }
    if (hadRecord) {
      renameSync(recordPath, backupRecord);
      backedUpRecord = true;
    }
    renameSync(stagedExecutable, executablePath);
    installedExecutable = true;
    renameSync(stagedRecord, recordPath);
    installedRecord = true;
  } catch (error) {
    const rollbackErrors = [];
    if (installedRecord) {
      try { fs.rmSync(recordPath, { force: true }); } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (installedExecutable) {
      try { fs.rmSync(executablePath, { force: true }); } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (backedUpExecutable) {
      try { renameSync(backupExecutable, executablePath); } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (backedUpRecord) {
      try { renameSync(backupRecord, recordPath); } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    const cause = rollbackErrors.length === 0
      ? error
      : new AggregateError([error, ...rollbackErrors], 'Provider helper rollback failed');
    const installationError = new Error('Provider helper installation failed', { cause });
    if (rollbackErrors.length > 0) {
      installationError[PRESERVE_RECOVERY_DIRECTORY] = true;
    }
    throw installationError;
  }
}

function buildProviderJobHost(options = {}) {
  const {
    sourcePath = path.join(ROOT, 'resources', 'windows', 'provider-job-host.cs'),
    outputDirectory = path.join(ROOT, 'resources', 'windows', 'generated'),
    spawnSync = childProcess.spawnSync,
    renameSync = fs.renameSync,
  } = options;
  const compilerCandidates = Object.hasOwn(options, 'compilerCandidates')
    ? options.compilerCandidates
    : defaultCompilerCandidates();
  if (process.platform !== 'win32' && !Object.hasOwn(options, 'compilerCandidates')) {
    throw new Error('Provider helper compilation requires Windows');
  }
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)
      || typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory)
      || typeof spawnSync !== 'function' || typeof renameSync !== 'function') {
    throw new TypeError('Provider helper build options are invalid');
  }
  const normalizedSource = path.normalize(sourcePath);
  const normalizedOutput = path.normalize(outputDirectory);
  if (!fs.statSync(normalizedSource).isFile()) {
    throw new Error('Provider helper source is unavailable');
  }
  const compilerPath = resolveCompiler(compilerCandidates);
  const compilerVersion = readCompilerVersion(spawnSync, compilerPath);
  fs.mkdirSync(normalizedOutput, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(path.join(normalizedOutput, '.build-'));
  if (!isWithin(normalizedOutput, temporaryDirectory)) {
    throw new Error('Provider helper temporary path escaped its output directory');
  }
  const stagedSource = path.join(temporaryDirectory, 'provider-job-host.cs');
  const stagedExecutable = path.join(temporaryDirectory, OUTPUT_NAMES.executable);
  const stagedRecord = path.join(temporaryDirectory, OUTPUT_NAMES.record);
  const executablePath = path.join(normalizedOutput, OUTPUT_NAMES.executable);
  const recordPath = path.join(normalizedOutput, OUTPUT_NAMES.record);
  let preserveRecoveryDirectory = false;
  try {
    fs.copyFileSync(normalizedSource, stagedSource, fs.constants.COPYFILE_EXCL);
    const sourceSha256 = sha256File(stagedSource);
    const compile = spawnCompiler(spawnSync, compilerPath, [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      '/warnaserror+',
      '/utf8output',
      `/out:${stagedExecutable}`,
      stagedSource,
    ]);
    if (compile.stdout.trim() !== '' || compile.stderr.trim() !== '') {
      throw new Error('Provider helper compilation failed');
    }
    let executable;
    try {
      executable = fs.statSync(stagedExecutable);
    } catch (error) {
      throw new Error('Provider helper compilation failed', { cause: error });
    }
    if (!executable.isFile() || executable.size <= 0) {
      throw new Error('Provider helper compilation failed');
    }
    if (sha256File(normalizedSource) !== sourceSha256) {
      throw new Error('Provider helper source changed during compilation');
    }
    const record = Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      architecture: 'x64',
      compilerPath,
      compilerVersion,
      sourceSha256,
      executableSha256: sha256File(stagedExecutable),
    });
    fs.writeFileSync(stagedRecord, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    installGeneratedPair({
      stagedExecutable,
      stagedRecord,
      executablePath,
      recordPath,
      temporaryDirectory,
      outputDirectory: normalizedOutput,
      renameSync,
    });
    return record;
  } catch (error) {
    preserveRecoveryDirectory = error?.[PRESERVE_RECOVERY_DIRECTORY] === true;
    throw error;
  } finally {
    if (!preserveRecoveryDirectory && isWithin(normalizedOutput, temporaryDirectory)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  const result = buildProviderJobHost();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  OUTPUT_NAMES,
  PROTOCOL_VERSION,
  buildProviderJobHost,
  defaultCompilerCandidates,
};
