'use strict';

const STAGES = Object.freeze([
  'discovery', 'evidence-lookup', 'qualification', 'login-status',
  'config', 'lease', 'provider-start',
]);

function createStageTimer({ enabled = false } = {}) {
  const rows = [];
  return Object.freeze({
    async stage(name, fn) {
      if (!STAGES.includes(name)) throw new TypeError('Unknown stage');
      if (!enabled) return fn();
      const started = process.hrtime.bigint();
      let outcome = 'ok';
      try {
        return await fn();
      } catch (error) {
        outcome = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        throw error;
      } finally {
        rows.push(Object.freeze({
          name,
          ms: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
          outcome,
        }));
      }
    },
    report() { return Object.freeze([...rows]); },
  });
}

module.exports = { STAGES, createStageTimer };
