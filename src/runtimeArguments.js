'use strict';

function promptPortFromArguments(argumentsList) {
  if (!Array.isArray(argumentsList)) return null;
  const matches = argumentsList.filter(
    (value) => typeof value === 'string' && value.startsWith('--prompt-port='),
  );
  if (matches.length !== 1) return null;
  const value = matches[0].slice('--prompt-port='.length);
  if (!/^[1-9]\d{0,4}$/.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port <= 65535 ? port : null;
}

module.exports = { promptPortFromArguments };
