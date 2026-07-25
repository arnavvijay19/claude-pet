'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validActivityView(value) {
  return value === 'simple' || value === 'comprehensive';
}

function createResponsePreferences({ filePath }) {
  function read() {
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return validActivityView(value?.activityView) ? value.activityView : null;
    } catch {
      return null;
    }
  }

  function write(activityView) {
    if (!validActivityView(activityView)) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ activityView }), 'utf8');
    } catch {
      // Preferences are optional and must never interrupt an agent response.
    }
  }

  return Object.freeze({ read, write });
}

module.exports = { createResponsePreferences };
