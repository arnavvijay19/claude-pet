'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  codexVersionAllowed,
  discoverSignedNativeCli,
} = require('../src/agent/nativeCliDiscovery.js');

const BASE_ENVIRONMENT = Object.freeze({
  LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local',
  USERPROFILE: 'C:\\Users\\Tester',
  TEMP: 'C:\\Users\\Tester\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\Tester\\AppData\\Local\\Temp',
  SYSTEMROOT: 'C:\\Windows',
  PATH: 'C:\\safe;;relative;D:\\tools',
  SECRET_THAT_MUST_NOT_LEAK: 'secret',
});

const PROVIDERS = Object.freeze({
  'codex-cli': Object.freeze({
    candidate: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe',
    canonical: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.145.0-x86_64-pc-windows-msvc\\bin\\codex.exe',
    executable: 'codex.exe',
    publisher: 'OpenAI OpCo, LLC',
    version: '0.145.0',
  }),
  'claude-code-cli': Object.freeze({
    candidate: 'C:\\Users\\Tester\\.local\\bin\\claude.exe',
    canonical: 'C:\\Users\\Tester\\.local\\bin\\claude.exe',
    executable: 'claude.exe',
    publisher: 'Anthropic, PBC',
    version: '2.1.217',
  }),
});

const CODEX_JUNCTION = Object.freeze({
  path: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin',
  target: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.145.0-x86_64-pc-windows-msvc\\bin',
});
const CODEX_CURRENT = 'C:\\Users\\Tester\\.codex\\packages\\standalone\\current';
const CODEX_RELEASE_ROOT = 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases';
const CODEX_RELEASE_SUFFIX = '-x86_64-pc-windows-msvc';
const CODEX_RELEASE = 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.145.0-x86_64-pc-windows-msvc';
const CODEX_REPARSE_CHAIN = Object.freeze([
  Object.freeze({
    path: CODEX_JUNCTION.path,
    rawTarget: `${CODEX_CURRENT}\\bin`,
    type: 'junction',
  }),
  Object.freeze({
    path: CODEX_CURRENT,
    rawTarget: CODEX_RELEASE,
    type: 'junction',
  }),
]);

function codexRelease(version) {
  const release = `${CODEX_RELEASE_ROOT}\\${version}${CODEX_RELEASE_SUFFIX}`;
  const target = `${release}\\bin`;
  return Object.freeze({
    version,
    release,
    target,
    canonical: `${target}\\codex.exe`,
    chain: Object.freeze([
      Object.freeze({
        path: CODEX_JUNCTION.path,
        rawTarget: `${CODEX_CURRENT}\\bin`,
        type: 'junction',
      }),
      Object.freeze({
        path: CODEX_CURRENT,
        rawTarget: release,
        type: 'junction',
      }),
    ]),
  });
}

// Current OpenAI installer layout: installerBin is a single junction straight to release\bin.
const CODEX_SINGLE_REPARSE_CHAIN = Object.freeze([
  Object.freeze({
    path: CODEX_JUNCTION.path,
    rawTarget: `${CODEX_RELEASE}\\bin`,
    type: 'junction',
  }),
]);

function expectedCodexReleasePolicy(overrides = {}) {
  return {
    minimumVersion: '0.145.0',
    blockedVersions: [],
    releaseRoot: CODEX_RELEASE_ROOT,
    releaseSuffix: CODEX_RELEASE_SUFFIX,
    installerBin: CODEX_JUNCTION.path,
    standaloneCurrent: CODEX_CURRENT,
    ...overrides,
  };
}

function validDynamicCodexInspection(version, overrides = {}) {
  const release = codexRelease(version);
  return validInspection('codex-cli', PROVIDERS['codex-cli'].candidate, {
    path: release.canonical,
    reparseChain: release.chain,
    version,
    junctionTarget: release.target,
    ...overrides,
  });
}

function validInspection(provider, candidate, overrides = {}) {
  const policy = PROVIDERS[provider];
  const codexJunction = provider === 'codex-cli';
  return {
    path: codexJunction ? policy.canonical : candidate,
    regularFile: true,
    reparsePoint: codexJunction,
    reparseChain: codexJunction ? CODEX_REPARSE_CHAIN : [],
    signatureValid: true,
    sha256: 'A'.repeat(64),
    volumeSerial: '12345678',
    fileId: '1122334455667788',
    version: policy.version,
    publisher: policy.publisher,
    ...(codexJunction ? {
      junctionPath: CODEX_JUNCTION.path,
      junctionTarget: CODEX_JUNCTION.target,
    } : {}),
    ...overrides,
  };
}

function discoveryOptions(provider, overrides = {}) {
  const policy = PROVIDERS[provider];
  return {
    provider,
    workspacePath: 'Z:\\work\\project',
    environment: { ...BASE_ENVIRONMENT },
    resolveCandidates: async () => [policy.candidate],
    inspectCandidate: async (candidate) => validInspection(provider, candidate),
    ...overrides,
  };
}

async function rejectsAsNotInstalled(options) {
  await assert.rejects(
    discoverSignedNativeCli(options),
    (error) => error.code === 'CLI_NOT_INSTALLED',
  );
}

test('discoverSignedNativeCli returns an immutable exact signed binding for each provider', async () => {
  for (const [provider, policy] of Object.entries(PROVIDERS)) {
    const resolverCalls = [];
    const inspectorCalls = [];
    const binding = await discoverSignedNativeCli(discoveryOptions(provider, {
      resolveCandidates: async (command, options) => {
        resolverCalls.push({ command, options });
        return [policy.candidate];
      },
      inspectCandidate: async (candidate, options) => {
        inspectorCalls.push({ candidate, options });
        return validInspection(provider, candidate);
      },
    }));

    assert.deepEqual(binding, {
      path: policy.canonical,
      sha256: 'a'.repeat(64),
      volumeSerial: '12345678',
      fileId: '1122334455667788',
      version: policy.version,
      publisher: policy.publisher,
    });
    assert.equal(Object.isFrozen(binding), true);
    assert.equal(resolverCalls.length, 1);
    assert.equal(resolverCalls[0].command, policy.executable);
    assert.equal(resolverCalls[0].options.systemRoot, 'C:\\Windows');
    assert.equal(resolverCalls[0].options.environment.PATH, 'C:\\safe;D:\\tools');
    assert.equal(resolverCalls[0].options.environment.SECRET_THAT_MUST_NOT_LEAK, undefined);
    assert.equal(inspectorCalls.length, 1);
    assert.equal(inspectorCalls[0].candidate, policy.candidate);
    if (provider === 'codex-cli') {
      assert.deepEqual(inspectorCalls[0].options.codexReleasePolicy, expectedCodexReleasePolicy());
      assert.equal(inspectorCalls[0].options.expectedVersion, undefined);
      assert.equal(inspectorCalls[0].options.expectedReparseChain, undefined);
    } else {
      assert.equal(inspectorCalls[0].options.codexReleasePolicy, undefined);
      assert.equal(inspectorCalls[0].options.expectedVersion, policy.version);
      assert.deepEqual(inspectorCalls[0].options.expectedReparseChain, []);
    }
  }
});

test('discovery returns the retained verified session with its immutable binding', async () => {
  const session = { release: async () => {} };
  const discovered = await discoverSignedNativeCli(discoveryOptions('codex-cli', {
    retainSession: true,
    inspectCandidate: async (candidate, options) => {
      assert.equal(options.retainSession, true);
      return { inspection: validInspection('codex-cli', candidate), session };
    },
  }));

  assert.equal(discovered.session, session);
  assert.equal(Object.isFrozen(discovered), true);
  assert.equal(Object.isFrozen(discovered.binding), true);
  assert.equal(discovered.binding.path, PROVIDERS['codex-cli'].canonical);
});

test('Codex discovery binds supported dynamic release versions without a positive allowlist', async () => {
  for (const version of ['0.145.0', '0.146.0', '0.200.1']) {
    const release = codexRelease(version);
    const binding = await discoverSignedNativeCli(discoveryOptions('codex-cli', {
      inspectCandidate: async (candidate, options) => {
        assert.equal(candidate, PROVIDERS['codex-cli'].candidate);
        assert.deepEqual(options.codexReleasePolicy, expectedCodexReleasePolicy());
        return validDynamicCodexInspection(version);
      },
    }));
    assert.deepEqual(binding, {
      path: release.canonical,
      sha256: 'a'.repeat(64),
      volumeSerial: '12345678',
      fileId: '1122334455667788',
      version,
      publisher: 'OpenAI OpCo, LLC',
    });
  }
});

test('Codex discovery binds the current single-junction release layout (installerBin -> release\\bin)', async () => {
  const lexicalCandidate = `${CODEX_JUNCTION.path}\\codex.exe`;
  const canonicalTarget = `${CODEX_RELEASE}\\bin\\codex.exe`;
  const binding = await discoverSignedNativeCli(discoveryOptions('codex-cli', {
    resolveCandidates: async () => [lexicalCandidate],
    inspectCandidate: async (candidate, options) => {
      assert.equal(candidate, lexicalCandidate);
      assert.deepEqual(options.codexReleasePolicy, expectedCodexReleasePolicy());
      return validInspection('codex-cli', candidate, {
        path: canonicalTarget,
        reparsePoint: true,
        reparseChain: CODEX_SINGLE_REPARSE_CHAIN,
        junctionPath: CODEX_JUNCTION.path,
        junctionTarget: `${CODEX_RELEASE}\\bin`,
      });
    },
  }));
  assert.equal(binding.path, canonicalTarget);
  assert.equal(binding.version, '0.145.0');
  assert.equal(binding.publisher, 'OpenAI OpCo, LLC');
});

test('Codex version policy enforces strict semver, the floor, and only an emergency denylist', () => {
  const policy = { minimumVersion: '0.145.0', blockedVersions: ['0.146.0'] };
  assert.equal(codexVersionAllowed('0.145.0', policy), true);
  assert.equal(codexVersionAllowed('0.146.0', policy), false);
  assert.equal(codexVersionAllowed('0.200.1', policy), true);
  for (const version of [
    '0.144.9', 'v0.146.0', '0.146', '01.146.0',
    '0.146.0-arm64-pc-windows-msvc',
    '0.146.0-x86_64-pc-windows-msvc-extra',
    '..\\0.146.0-x86_64-pc-windows-msvc',
  ]) {
    assert.equal(codexVersionAllowed(version, policy), false, version);
  }
});

test('workspace-local first match is skipped without inspection and a later official candidate is used', async () => {
  const provider = 'codex-cli';
  const policy = PROVIDERS[provider];
  const workspacePath = 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\project';
  const workspaceCandidate = `${workspacePath}\\codex.exe`;
  const inspected = [];
  const binding = await discoverSignedNativeCli(discoveryOptions(provider, {
    workspacePath,
    resolveCandidates: async () => [workspaceCandidate, policy.candidate],
    inspectCandidate: async (candidate) => {
      inspected.push(candidate);
      return validInspection(provider, candidate);
    },
  }));

  assert.equal(binding.path, policy.canonical);
  assert.deepEqual(inspected, [policy.candidate]);
});

test('only the strict Codex launcher junction shape may bind its held canonical package target', async () => {
  const provider = 'codex-cli';
  const lexicalCandidate = `${CODEX_JUNCTION.path}\\codex.exe`;
  const canonicalTarget = `${CODEX_JUNCTION.target}\\codex.exe`;
  const binding = await discoverSignedNativeCli(discoveryOptions(provider, {
    resolveCandidates: async () => [lexicalCandidate],
    inspectCandidate: async (candidate, options) => {
      assert.equal(candidate, lexicalCandidate);
      assert.deepEqual(options.codexReleasePolicy, expectedCodexReleasePolicy());
      return validInspection(provider, candidate, {
        path: canonicalTarget,
        reparsePoint: true,
        reparseChain: CODEX_REPARSE_CHAIN,
        junctionPath: CODEX_JUNCTION.path,
        junctionTarget: CODEX_JUNCTION.target,
      });
    },
  }));

  assert.equal(binding.path, canonicalTarget);
  assert.equal(binding.version, '0.145.0');
});

test('Codex junction discovery rejects every lexical, raw-target, and canonical-target mismatch', async () => {
  const provider = 'codex-cli';
  const lexicalCandidate = `${CODEX_JUNCTION.path}\\codex.exe`;
  const canonicalTarget = `${CODEX_JUNCTION.target}\\codex.exe`;
  const wrongTarget = 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases\\0.145.1-x86_64-pc-windows-msvc\\bin';
  const wrongRelease = path.win32.dirname(wrongTarget);
  const invalidInspections = [
    { path: canonicalTarget, reparsePoint: true, reparseChain: [] },
    {
      path: canonicalTarget, reparsePoint: true, reparseChain: CODEX_REPARSE_CHAIN.slice(0, 1),
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true,
      reparseChain: [...CODEX_REPARSE_CHAIN, CODEX_REPARSE_CHAIN[1]],
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true, reparseChain: [...CODEX_REPARSE_CHAIN].reverse(),
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true,
      reparseChain: [{ ...CODEX_REPARSE_CHAIN[0], type: 'symbolic-link' }, CODEX_REPARSE_CHAIN[1]],
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true,
      reparseChain: [{ ...CODEX_REPARSE_CHAIN[0], rawTarget: `${wrongRelease}\\bin` }, CODEX_REPARSE_CHAIN[1]],
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true,
      reparseChain: [CODEX_REPARSE_CHAIN[0], { ...CODEX_REPARSE_CHAIN[1], rawTarget: wrongRelease }],
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true, reparseChain: CODEX_REPARSE_CHAIN,
      junctionPath: 'C:\\other', junctionTarget: CODEX_JUNCTION.target,
    },
    {
      path: canonicalTarget, reparsePoint: true, reparseChain: CODEX_REPARSE_CHAIN,
      junctionPath: CODEX_JUNCTION.path, junctionTarget: wrongTarget,
    },
    {
      path: `${wrongTarget}\\codex.exe`, reparsePoint: true, reparseChain: CODEX_REPARSE_CHAIN,
      junctionPath: CODEX_JUNCTION.path, junctionTarget: CODEX_JUNCTION.target,
    },
  ];
  for (const overrides of invalidInspections) {
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      resolveCandidates: async () => [lexicalCandidate],
      inspectCandidate: async (candidate) => validInspection(provider, candidate, overrides),
    }));
  }

  await rejectsAsNotInstalled(discoveryOptions(provider, {
    resolveCandidates: async () => ['C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\other\\codex.exe'],
    inspectCandidate: async (candidate) => validInspection(provider, candidate, {
      path: canonicalTarget,
      reparsePoint: true,
      reparseChain: CODEX_REPARSE_CHAIN,
      junctionPath: CODEX_JUNCTION.path,
      junctionTarget: CODEX_JUNCTION.target,
    }),
  }));
});

test('discovery rejects relative, cmd, wrong-root, and wrong-name matches before inspection', async () => {
  const provider = 'codex-cli';
  const root = 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex';
  for (const candidate of [
    'relative\\codex.exe',
    `${root}\\codex.cmd`,
    `${root}\\other.exe`,
    'D:\\OpenAI\\Codex\\codex.exe',
  ]) {
    let inspected = false;
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      resolveCandidates: async () => [candidate],
      inspectCandidate: async () => {
        inspected = true;
        return validInspection(provider, candidate);
      },
    }));
    assert.equal(inspected, false, candidate);
  }
});

test('discovery rejects reparse components, non-files, invalid signatures, and incomplete identity evidence', async () => {
  const provider = 'claude-code-cli';
  const invalidFacts = [
    {
      reparsePoint: true,
      reparseChain: [{ path: 'C:\\Users\\Tester\\.local', rawTarget: 'C:\\other', type: 'junction' }],
    },
    { regularFile: false },
    { signatureValid: false },
    { signatureValid: undefined },
    { sha256: 'not-a-sha256' },
    { volumeSerial: '' },
    { fileId: '' },
  ];
  for (const overrides of invalidFacts) {
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      inspectCandidate: async (candidate) => validInspection(provider, candidate, overrides),
    }));
  }
});

test('discovery rejects wrong publisher, wrong version, and canonical path replacement', async () => {
  const provider = 'codex-cli';
  for (const overrides of [
    { publisher: 'Unknown Publisher' },
    { publisher: 'Anthropic, PBC' },
    { version: '0.145.1' },
    { path: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\replacement\\codex.exe' },
  ]) {
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      inspectCandidate: async (candidate) => validInspection(provider, candidate, overrides),
    }));
  }
});

test('discovery continues after a bad candidate and accepts only the later complete inspection', async () => {
  const provider = 'codex-cli';
  const policy = PROVIDERS[provider];
  const first = 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI\\Codex\\old\\codex.exe';
  const inspected = [];
  const binding = await discoverSignedNativeCli(discoveryOptions(provider, {
    resolveCandidates: async () => [first, policy.candidate],
    inspectCandidate: async (candidate) => {
      inspected.push(candidate);
      if (candidate === first) return validInspection(provider, candidate, { version: '0.144.0' });
      return validInspection(provider, candidate);
    },
  }));

  assert.equal(binding.path, policy.canonical);
  assert.deepEqual(inspected, [policy.candidate]);
});

test('blank Codex PE metadata cannot replace the exact bounded CLI version result', async () => {
  const provider = 'codex-cli';
  const accepted = await discoverSignedNativeCli(discoveryOptions(provider, {
    inspectCandidate: async (candidate) => validInspection(provider, candidate, {
      fileVersion: '',
      version: '0.145.0',
    }),
  }));
  assert.equal(accepted.version, '0.145.0');

  for (const version of ['', undefined, '0.145.1']) {
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      inspectCandidate: async (candidate) => validInspection(provider, candidate, {
        fileVersion: '',
        version,
      }),
    }));
  }
});

test('binding copies path, hash, and file identity so later inspector mutation cannot replace it', async () => {
  const provider = 'codex-cli';
  const policy = PROVIDERS[provider];
  const inspection = validInspection(provider, policy.candidate);
  const binding = await discoverSignedNativeCli(discoveryOptions(provider, {
    inspectCandidate: async () => inspection,
  }));

  inspection.path = 'C:\\replaced\\codex.exe';
  inspection.sha256 = 'b'.repeat(64);
  inspection.fileId = 'replaced';
  assert.deepEqual(binding, {
    path: policy.canonical,
    sha256: 'a'.repeat(64),
    volumeSerial: '12345678',
    fileId: '1122334455667788',
    version: policy.version,
    publisher: policy.publisher,
  });
});

test('official roots under the workspace, app temp, or repository are excluded', async () => {
  const provider = 'codex-cli';
  const policy = PROVIDERS[provider];
  const excludedCases = [
    {
      workspacePath: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI',
      environment: { ...BASE_ENVIRONMENT },
      candidate: policy.candidate,
    },
    {
      workspacePath: 'Z:\\work\\project',
      environment: {
        ...BASE_ENVIRONMENT,
        TEMP: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI',
        TMP: 'C:\\Users\\Tester\\AppData\\Local\\Programs\\OpenAI',
      },
      candidate: policy.candidate,
    },
  ];

  const repositoryRoot = path.win32.resolve(__dirname, '..');
  const repositoryLocalAppData = path.win32.join(repositoryRoot, 'test-local-app-data');
  excludedCases.push({
    workspacePath: 'Z:\\work\\project',
    environment: { ...BASE_ENVIRONMENT, LOCALAPPDATA: repositoryLocalAppData },
    candidate: path.win32.join(repositoryLocalAppData, 'Programs', 'OpenAI', 'Codex', 'codex.exe'),
  });

  for (const item of excludedCases) {
    let inspected = false;
    await rejectsAsNotInstalled(discoveryOptions(provider, {
      workspacePath: item.workspacePath,
      environment: item.environment,
      resolveCandidates: async () => [item.candidate],
      inspectCandidate: async () => {
        inspected = true;
        return validInspection(provider, item.candidate);
      },
    }));
    assert.equal(inspected, false, item.candidate);
  }
});

test('the pinned Codex canonical target is rejected when it falls inside an exclusion root', async () => {
  const provider = 'codex-cli';
  let inspected = false;
  await rejectsAsNotInstalled(discoveryOptions(provider, {
    workspacePath: 'C:\\Users\\Tester\\.codex\\packages\\standalone\\releases',
    inspectCandidate: async (candidate) => {
      inspected = true;
      return validInspection(provider, candidate);
    },
  }));
  assert.equal(inspected, false);
});
