'use strict';

const ERROR_CODES = Object.freeze([
  'AGENT_REQUIRED',
  'CLI_NOT_INSTALLED',
  'AUTH_REQUIRED',
  'WORKSPACE_UNAVAILABLE',
  'PERMISSION_PROFILE_UNAVAILABLE',
  'PERMISSION_BLOCKED',
  'AGENT_BUSY',
  'COMMAND_FAILED',
  'REQUEST_TIMEOUT',
  'RUN_STOPPED',
  'MODEL_UNAVAILABLE',
  'UNSUPPORTED_OPTION',
  'RATE_LIMITED',
  'QUOTA_OR_BILLING',
  'PROVIDER_OUTPUT_INVALID',
  'ACTIVITY_INVALID',
  'SECRET_STORE_FAILED',
  'FULL_COMPUTER_CONFIRMATION_REQUIRED',
  'FULL_COMPUTER_CONFIRMATION_CANCELLED',
  'NATIVE_FULL_COMPUTER_LAUNCH_FAILED',
  'SESSION_PERSISTENCE_UNAVAILABLE',
]);

const PUBLIC_ERROR_BY_CODE = Object.freeze({
  AGENT_REQUIRED: Object.freeze({ message: 'Choose an agent before starting.', action: 'Select an agent and try again.' }),
  CLI_NOT_INSTALLED: Object.freeze({ message: 'The agent command is not installed.', action: 'Install the agent command and try again.' }),
  AUTH_REQUIRED: Object.freeze({ message: 'The agent needs you to sign in.', action: 'Finish agent setup and try again.' }),
  WORKSPACE_UNAVAILABLE: Object.freeze({ message: 'The workspace is unavailable.', action: 'Open an available workspace and try again.' }),
  PERMISSION_PROFILE_UNAVAILABLE: Object.freeze({ message: 'The permission profile is unavailable.', action: 'Choose an available permission profile.' }),
  PERMISSION_BLOCKED: Object.freeze({ message: 'The requested action was blocked.', action: 'Review the permission profile and try again.' }),
  AGENT_BUSY: Object.freeze({ message: 'The agent is already working.', action: 'Wait for the current run or stop it.' }),
  COMMAND_FAILED: Object.freeze({ message: 'The agent command failed.', action: 'Review the activity and try again.' }),
  REQUEST_TIMEOUT: Object.freeze({ message: 'The agent request timed out.', action: 'Try the request again.' }),
  RUN_STOPPED: Object.freeze({ message: 'The agent run was stopped.', action: 'Start a new run when ready.' }),
  MODEL_UNAVAILABLE: Object.freeze({ message: 'The selected model is unavailable.', action: 'Choose an available model.' }),
  UNSUPPORTED_OPTION: Object.freeze({ message: 'The selected option is unsupported.', action: 'Choose a supported option.' }),
  RATE_LIMITED: Object.freeze({ message: 'The agent is temporarily rate limited.', action: 'Wait and try again.' }),
  QUOTA_OR_BILLING: Object.freeze({ message: 'The agent account cannot run this request.', action: 'Review account quota or billing.' }),
  PROVIDER_OUTPUT_INVALID: Object.freeze({ message: 'The agent returned an invalid response.', action: 'Try again or choose another agent.' }),
  ACTIVITY_INVALID: Object.freeze({ message: 'The agent returned invalid activity.', action: 'Stop the run and review the agent setup.' }),
  SECRET_STORE_FAILED: Object.freeze({ message: 'Secure settings could not be saved.', action: 'Check secure storage and try again.' }),
  FULL_COMPUTER_CONFIRMATION_REQUIRED: Object.freeze({ message: 'Full Computer confirmation is required.', action: 'Review the warning and confirm this saved connection.' }),
  FULL_COMPUTER_CONFIRMATION_CANCELLED: Object.freeze({ message: 'Full Computer was not enabled.', action: 'Choose Workspace or confirm Full Computer when ready.' }),
  NATIVE_FULL_COMPUTER_LAUNCH_FAILED: Object.freeze({ message: 'The Full Computer agent could not start.', action: 'Check the native agent installation and try again.' }),
  SESSION_PERSISTENCE_UNAVAILABLE: Object.freeze({ message: 'Session history could not be saved.', action: 'Check secure storage and try again.' }),
});

class AgentError extends Error {
  constructor(code, options = {}) {
    const publicCopy = PUBLIC_ERROR_BY_CODE[code] || PUBLIC_ERROR_BY_CODE.COMMAND_FAILED;
    super(publicCopy.message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AgentError';
    this.code = PUBLIC_ERROR_BY_CODE[code] ? code : 'COMMAND_FAILED';
    this.requestId = typeof options.requestId === 'string' ? options.requestId : null;
  }
}

function toPublicError(error) {
  const code = error instanceof AgentError && PUBLIC_ERROR_BY_CODE[error.code]
    ? error.code
    : 'COMMAND_FAILED';
  const copy = PUBLIC_ERROR_BY_CODE[code];
  return {
    code,
    message: copy.message,
    action: copy.action,
    requestId: error instanceof AgentError ? error.requestId : null,
  };
}

module.exports = {
  AgentError,
  ERROR_CODES,
  PUBLIC_ERROR_BY_CODE,
  toPublicError,
};
