'use strict';

function createSafeStorageCrypto(safeStorage) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function'
    || typeof safeStorage.encryptString !== 'function') {
    throw new TypeError('Electron safeStorage is required');
  }

  return Object.freeze({
    async isAvailable() {
      return Boolean(await safeStorage.isEncryptionAvailable());
    },
    async encrypt(value) {
      return safeStorage.encryptString(value);
    },
    async decrypt(buffer) {
      if (typeof safeStorage.decryptStringAsync === 'function') {
        const decrypted = await safeStorage.decryptStringAsync(buffer);
        return {
          value: decrypted.result,
          shouldReEncrypt: Boolean(decrypted.shouldReEncrypt),
        };
      }
      return { value: safeStorage.decryptString(buffer), shouldReEncrypt: false };
    },
  });
}

module.exports = { createSafeStorageCrypto };
