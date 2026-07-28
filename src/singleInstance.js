'use strict';

function claimSingleInstance(app, revealPrimaryInstance) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on('second-instance', revealPrimaryInstance);
  return true;
}

module.exports = { claimSingleInstance };
