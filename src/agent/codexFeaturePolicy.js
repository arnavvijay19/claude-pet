'use strict';

const { AgentError } = require('./agentErrors.js');

const CODEX_DISABLED_FEATURES = Object.freeze([
  'apps', 'auth_elicitation', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'code_mode_host', 'computer_use', 'hooks',
  'goals', 'guardian_approval', 'image_generation', 'in_app_browser', 'memories',
  'in_app_updates', 'multi_agent', 'plugins', 'plugin_sharing', 'remote_plugin',
  'skill_mcp_dependency_install', 'skill_search', 'tool_call_mcp_elicitation',
  'tool_suggest', 'workspace_dependencies',
]);

const CODEX_KNOWN_0145_FEATURES = Object.freeze([
  'apply_patch_freeform', 'apply_patch_streaming_events', 'apps', 'apps_mcp_path_override',
  'artifact', 'auth_elicitation', 'browser_use', 'browser_use_external',
  'browser_use_full_cdp_access', 'chronicle', 'code_mode', 'code_mode_buffered_exec',
  'code_mode_host', 'code_mode_only', 'codex_git_commit', 'collaboration_modes',
  'computer_use', 'concurrent_reasoning_summaries', 'current_time_reminder',
  'default_mode_request_user_input', 'deferred_executor', 'elevated_windows_sandbox',
  'enable_fanout', 'enable_mcp_apps', 'enable_request_compression',
  'exec_permission_approvals', 'executor_capability_discovery',
  'experimental_windows_sandbox', 'external_agent_memory_import', 'external_migration',
  'fast_mode', 'goals', 'guardian_approval', 'hooks', 'image_detail_original',
  'image_generation', 'in_app_browser', 'item_ids', 'js_repl', 'js_repl_tools_only',
  'local_thread_store_compression', 'memories', 'mentions_v2', 'multi_agent',
  'multi_agent_mode', 'multi_agent_v2', 'network_proxy', 'non_prefixed_mcp_tool_names',
  'personality', 'plugin_hooks', 'plugin_sharing', 'plugins', 'prevent_idle_sleep',
  'realtime_conversation', 'remote_compaction_v2', 'remote_control', 'remote_models',
  'remote_plugin', 'request_permissions_tool', 'request_rule', 'resize_all_images',
  'respect_system_proxy', 'responses_websockets', 'responses_websockets_v2',
  'rollout_budget', 'runtime_metrics', 'search_tool', 'secret_auth_storage',
  'shell_snapshot', 'shell_tool', 'shell_zsh_fork', 'skill_env_var_dependency_prompt',
  'skill_mcp_dependency_install', 'skill_search', 'sqlite', 'standalone_web_search',
  'steer', 'terminal_resize_reflow', 'terminal_visualization_instructions', 'token_budget',
  'tool_call_mcp_elicitation', 'tool_search', 'tool_search_always_defer_mcp_tools',
  'tool_suggest', 'tui_app_server', 'unavailable_dummy_tools', 'undo', 'unified_exec',
  'unified_exec_zsh_fork', 'use_agent_identity', 'use_legacy_landlock',
  'use_linux_sandbox_bwrap', 'web_search_cached', 'web_search_request',
  'workspace_dependencies', 'workspace_owner_usage_nudge',
]);

const CODEX_SAFE_ENABLED_FEATURES = Object.freeze([
  'collaboration_modes', 'enable_request_compression', 'fast_mode', 'mentions_v2',
  'item_ids', 'personality', 'remote_compaction_v2', 'resize_all_images', 'secret_auth_storage',
  'shell_snapshot', 'shell_tool', 'sqlite', 'steer', 'terminal_resize_reflow',
  'tool_search_always_defer_mcp_tools', 'tui_app_server',
]);

const CODE_MODE_PROJECTION = Object.freeze({
  additionalTools: Object.freeze([
    Object.freeze({ name: 'exec', type: 'custom' }),
    Object.freeze({ name: 'wait', type: 'function' }),
    Object.freeze({ name: 'request_user_input', type: 'function' }),
    Object.freeze({ name: 'collaboration', type: 'namespace' }),
  ]),
  collaborationTools: Object.freeze([
    'followup_task', 'interrupt_agent', 'list_agents', 'send_message',
    'spawn_agent', 'wait_agent',
  ]),
  execRegistry: Object.freeze(['apply_patch', 'shell_command', 'update_plan', 'view_image']),
});

function unavailable(cause) {
  return new AgentError('PERMISSION_PROFILE_UNAVAILABLE', { cause });
}

function parseCodexFeatureList(output) {
  if (typeof output !== 'string' || !output.endsWith('\n')) throw unavailable();
  const lines = output.split(/\r?\n/);
  lines.pop();
  if (lines.length === 0) throw unavailable();
  return lines.map((line) => {
    const match = /^(\S+)\s{2,}(.+?)\s{2,}(true|false)$/.exec(line);
    if (!match) throw unavailable();
    return { name: match[1], stage: match[2], enabled: match[3] === 'true' };
  });
}

function assertCodexFeaturePolicy(records) {
  if (!Array.isArray(records) || records.length === 0) throw unavailable();
  const names = records.map((record) => record?.name);
  if (names.some((name) => typeof name !== 'string' || !name)
      || new Set(names).size !== names.length) throw unavailable();
  for (const record of records) {
    if (typeof record.stage !== 'string' || !record.stage
        || typeof record.enabled !== 'boolean') throw unavailable();
    if (record.enabled && !CODEX_SAFE_ENABLED_FEATURES.includes(record.name)) throw unavailable();
    if (record.enabled && CODEX_DISABLED_FEATURES.includes(record.name)) throw unavailable();
  }
  return true;
}

function codexFeatureArgs() {
  return [
    '--strict-config',
    ...CODEX_DISABLED_FEATURES.flatMap((name) => ['--disable', name]),
    '-c', 'web_search="disabled"',
  ];
}

function codexFeatureInspectionArgs() {
  const [, ...supportedArgs] = codexFeatureArgs();
  return supportedArgs;
}

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function validateCodexCodeModeProjection(value) {
  if (!plain(value) || Object.keys(value).join(',') !== 'additionalTools,collaborationTools,execRegistry'
      || JSON.stringify(value) !== JSON.stringify(CODE_MODE_PROJECTION)) throw unavailable();
  return CODE_MODE_PROJECTION;
}

module.exports = {
  CODEX_DISABLED_FEATURES,
  CODEX_KNOWN_0145_FEATURES,
  CODEX_SAFE_ENABLED_FEATURES,
  CODE_MODE_PROJECTION,
  assertCodexFeaturePolicy,
  codexFeatureArgs,
  codexFeatureInspectionArgs,
  parseCodexFeatureList,
  validateCodexCodeModeProjection,
};
