'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CODEX_DISABLED_FEATURES,
  CODEX_KNOWN_0145_FEATURES,
  CODEX_SAFE_ENABLED_FEATURES,
  assertCodexFeaturePolicy,
  codexFeatureArgs,
  parseCodexFeatureList,
  validateCodexCodeModeProjection,
} = require('../src/agent/codexFeaturePolicy.js');

const COMPLETE_0145_FEATURE_LIST = `apply_patch_freeform                 removed            false
apply_patch_streaming_events         under development  false
apps                                 stable             true
apps_mcp_path_override               removed            false
artifact                             under development  false
auth_elicitation                     stable             true
browser_use                          stable             true
browser_use_external                 stable             true
browser_use_full_cdp_access          stable             true
chronicle                            under development  false
code_mode                            under development  false
code_mode_buffered_exec              under development  false
code_mode_host                       stable             true
code_mode_only                       under development  false
codex_git_commit                     removed            false
collaboration_modes                  removed            true
computer_use                         stable             true
concurrent_reasoning_summaries       under development  false
current_time_reminder                under development  false
default_mode_request_user_input      under development  false
deferred_executor                    under development  false
elevated_windows_sandbox             removed            false
enable_fanout                        removed            false
enable_mcp_apps                      under development  false
enable_request_compression           stable             true
exec_permission_approvals            under development  false
executor_capability_discovery        under development  false
experimental_windows_sandbox         removed            false
external_agent_memory_import         under development  false
external_migration                   removed            false
fast_mode                            stable             true
goals                                stable             true
guardian_approval                    stable             true
hooks                                stable             true
image_detail_original                removed            false
image_generation                     stable             true
in_app_browser                       stable             true
item_ids                             under development  false
js_repl                              removed            false
js_repl_tools_only                   removed            false
local_thread_store_compression       under development  false
memories                             stable             true
mentions_v2                          stable             true
multi_agent                          stable             true
multi_agent_mode                     removed            false
multi_agent_v2                       stable             false
network_proxy                        experimental       false
non_prefixed_mcp_tool_names          under development  false
personality                          stable             true
plugin_hooks                         removed            false
plugin_sharing                       stable             true
plugins                              stable             true
prevent_idle_sleep                   experimental       false
realtime_conversation                under development  false
remote_compaction_v2                 stable             true
remote_control                       removed            false
remote_models                        removed            false
remote_plugin                        stable             true
request_permissions_tool             under development  false
request_rule                         removed            false
resize_all_images                    removed            true
respect_system_proxy                 under development  false
responses_websockets                 removed            false
responses_websockets_v2              removed            false
rollout_budget                       under development  false
runtime_metrics                      under development  false
search_tool                          removed            false
secret_auth_storage                  stable             true
shell_snapshot                       stable             true
shell_tool                           stable             true
shell_zsh_fork                       under development  false
skill_env_var_dependency_prompt      removed            false
skill_mcp_dependency_install         stable             true
skill_search                         stable             true
sqlite                               removed            true
standalone_web_search                under development  false
steer                                removed            true
terminal_resize_reflow               removed            true
terminal_visualization_instructions  under development  false
token_budget                         under development  false
tool_call_mcp_elicitation            stable             true
tool_search                          removed            false
tool_search_always_defer_mcp_tools   removed            true
tool_suggest                         stable             true
tui_app_server                       removed            true
unavailable_dummy_tools              removed            false
undo                                 removed            false
unified_exec                         stable             false
unified_exec_zsh_fork                under development  false
use_agent_identity                   under development  false
use_legacy_landlock                  deprecated         false
use_linux_sandbox_bwrap              removed            false
web_search_cached                    deprecated         false
web_search_request                   deprecated         false
workspace_dependencies               stable             true
workspace_owner_usage_nudge          removed            false
`;

const LITERAL_TOOL_PROJECTION = Object.freeze({
  additionalTools: [
    { name: 'exec', type: 'custom' },
    { name: 'wait', type: 'function' },
    { name: 'request_user_input', type: 'function' },
    { name: 'collaboration', type: 'namespace' },
  ],
  collaborationTools: [
    'followup_task', 'interrupt_agent', 'list_agents', 'send_message',
    'spawn_agent', 'wait_agent',
  ],
  execRegistry: ['apply_patch', 'shell_command', 'update_plan', 'view_image'],
});

test('parses the complete Codex 0.145.0 feature registry without losing multiword stages', () => {
  const records = parseCodexFeatureList(COMPLETE_0145_FEATURE_LIST);
  assert.equal(records.length, 96);
  assert.deepEqual(records[1], {
    name: 'apply_patch_streaming_events', stage: 'under development', enabled: false,
  });
  assert.deepEqual(records.at(-1), {
    name: 'workspace_owner_usage_nudge', stage: 'removed', enabled: false,
  });
  assert.deepEqual(records.map(({ name }) => name), CODEX_KNOWN_0145_FEATURES);
});

test('disables every known model-visible or non-local Codex surface with exact arguments', () => {
  assert.deepEqual(CODEX_DISABLED_FEATURES, [
    'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
    'browser_use_full_cdp_access', 'code_mode_host', 'computer_use', 'hooks',
    'goals', 'guardian_approval', 'image_generation', 'in_app_browser', 'memories',
    'multi_agent', 'plugins', 'plugin_sharing', 'remote_plugin',
    'skill_mcp_dependency_install', 'skill_search', 'tool_call_mcp_elicitation',
    'tool_suggest', 'workspace_dependencies',
  ]);
  assert.deepEqual(codexFeatureArgs(), [
    '--strict-config',
    ...CODEX_DISABLED_FEATURES.flatMap((name) => ['--disable', name]),
    '-c', 'web_search="disabled"',
  ]);
});

test('fails closed on enabled risky, unknown, malformed, or duplicate feature output', () => {
  const base = parseCodexFeatureList(COMPLETE_0145_FEATURE_LIST)
    .map((record) => CODEX_DISABLED_FEATURES.includes(record.name)
      ? { ...record, enabled: false }
      : record);
  assert.doesNotThrow(() => assertCodexFeaturePolicy(base));
  assert.deepEqual(
    base.filter(({ enabled }) => enabled).map(({ name }) => name),
    CODEX_SAFE_ENABLED_FEATURES,
  );
  for (const mutation of [
    [...base.filter(({ name }) => name !== 'apps'), { name: 'apps', stage: 'stable', enabled: true }],
    [...base, { name: 'future_remote_browser', stage: 'stable', enabled: true }],
    [...base, { name: 'future_disabled_surface', stage: 'stable', enabled: false }],
    [...base, base[0]],
  ]) {
    assert.throws(
      () => assertCodexFeaturePolicy(mutation),
      (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
    );
  }
  assert.throws(
    () => parseCodexFeatureList('browser_use stable maybe\n'),
    (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
  );
});

test('pins the independent GPT-5.6 code-mode projection as canonical UTF-8 with one LF', () => {
  const fixturePath = path.join(__dirname, '..', 'resources', 'probes', 'codex-0.145.0-code-mode-tools.json');
  const expected = `{\n  "additionalTools": [\n    { "name": "exec", "type": "custom" },\n    { "name": "wait", "type": "function" },\n    { "name": "request_user_input", "type": "function" },\n    { "name": "collaboration", "type": "namespace" }\n  ],\n  "collaborationTools": [\n    "followup_task",\n    "interrupt_agent",\n    "list_agents",\n    "send_message",\n    "spawn_agent",\n    "wait_agent"\n  ],\n  "execRegistry": [\n    "apply_patch",\n    "shell_command",\n    "update_plan",\n    "view_image"\n  ]\n}\n`;
  const bytes = fs.readFileSync(fixturePath);
  assert.equal(bytes.toString('utf8'), expected);
  assert.equal(bytes.at(-1), 0x0a);
  assert.equal(bytes.includes(0x0d), false);
  assert.deepEqual(validateCodexCodeModeProjection(JSON.parse(bytes)), LITERAL_TOOL_PROJECTION);
});

test('rejects extra classic, additional, collaboration, or nested exec tools', () => {
  const mutations = [
    { ...LITERAL_TOOL_PROJECTION, tools: [] },
    { ...LITERAL_TOOL_PROJECTION, additionalTools: [...LITERAL_TOOL_PROJECTION.additionalTools, { name: 'browser', type: 'function' }] },
    { ...LITERAL_TOOL_PROJECTION, collaborationTools: [...LITERAL_TOOL_PROJECTION.collaborationTools, 'close_agent'] },
    { ...LITERAL_TOOL_PROJECTION, execRegistry: [...LITERAL_TOOL_PROJECTION.execRegistry, 'exec_command'] },
    { ...LITERAL_TOOL_PROJECTION, execRegistry: [...LITERAL_TOOL_PROJECTION.execRegistry, 'write_stdin'] },
  ];
  for (const value of mutations) {
    assert.throws(
      () => validateCodexCodeModeProjection(value),
      (error) => error.code === 'PERMISSION_PROFILE_UNAVAILABLE',
    );
  }
});
