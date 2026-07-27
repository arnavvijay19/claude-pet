// src/renderer/pet.js
function createPetStateMachine(manifest) {
  if (!manifest || typeof manifest !== 'object' || !manifest.states || typeof manifest.states !== 'object') {
    throw new Error('Invalid pet manifest');
  }
  const stateNames = Object.keys(manifest.states);
  if (!stateNames.includes('idle') || stateNames.length === 0) throw new Error('Invalid pet manifest');

  for (const name of stateNames) {
    const state = manifest.states[name];
    if (!state || typeof state !== 'object'
        || !Number.isInteger(state.row) || state.row < 0
        || !Number.isInteger(state.frameCount) || state.frameCount < 1
        || !Number.isInteger(state.frameDurationMs) || state.frameDurationMs < 1
        || typeof state.loop !== 'boolean') throw new Error('Invalid pet manifest');
    if (!state.loop && (!state.nextState || !Object.hasOwn(manifest.states, state.nextState))) {
      throw new Error('Invalid pet manifest');
    }
    if (state.loop && Object.hasOwn(state, 'nextState')) throw new Error('Invalid pet manifest');
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error('Invalid pet manifest');
    if (visited.has(name)) return;
    visiting.add(name);
    const next = manifest.states[name].nextState;
    if (next) visit(next);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of stateNames) visit(name);

  let currentState = 'idle';
  let stateStartedAtMs = 0;

  return {
    setState(name, atMs = 0) {
      if (!manifest.states[name]) {
        throw new Error(`Unknown pet state: ${name}`);
      }
      if (!Number.isFinite(atMs)) throw new Error('Invalid pet timestamp');
      if (name === currentState) return;
      currentState = name;
      stateStartedAtMs = atMs;
    },
    getState() {
      return currentState;
    },
    getFrame(atMs) {
      if (!Number.isFinite(atMs)) throw new Error('Invalid pet timestamp');
      for (let hops = 0; hops <= stateNames.length; hops += 1) {
        const state = manifest.states[currentState];
        const sinceStateStart = Math.max(0, atMs - stateStartedAtMs);
        const cycleDuration = state.frameCount * state.frameDurationMs;

        if (state.loop) {
          const column = Math.floor(sinceStateStart / state.frameDurationMs) % state.frameCount;
          return { state: currentState, row: state.row, column };
        }
        if (sinceStateStart < cycleDuration) {
          const column = Math.min(state.frameCount - 1, Math.floor(sinceStateStart / state.frameDurationMs));
          return { state: currentState, row: state.row, column };
        }

        stateStartedAtMs += cycleDuration;
        currentState = state.nextState;
      }
      throw new Error('Invalid pet manifest');
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createPetStateMachine };
}
