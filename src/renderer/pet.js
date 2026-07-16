// src/renderer/pet.js
function createPetStateMachine(manifest) {
  let currentState = Object.keys(manifest.states)[0];
  let stateStartedAtMs = 0;

  return {
    setState(name, atMs = 0) {
      if (!manifest.states[name]) {
        throw new Error(`Unknown pet state: ${name}`);
      }
      currentState = name;
      stateStartedAtMs = atMs;
    },
    getFrame(elapsedMs) {
      const { row, frameCount } = manifest.states[currentState];
      const sinceStateStart = Math.max(0, elapsedMs - stateStartedAtMs);
      const column = Math.floor(sinceStateStart / manifest.frameDurationMs) % frameCount;
      return { row, column };
    },
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createPetStateMachine };
}
