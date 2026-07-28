'use strict';

function drawFrame(context, image, manifest, frame) {
  const { frameWidth, frameHeight } = manifest;
  context.clearRect(0, 0, frameWidth, frameHeight);
  context.drawImage(
    image,
    frame.column * frameWidth,
    frame.row * frameHeight,
    frameWidth,
    frameHeight,
    0,
    0,
    frameWidth,
    frameHeight,
  );
}

function installWindowDrag(canvas) {
  let previous = null;
  canvas.addEventListener('pointerdown', (event) => {
    previous = { x: event.screenX, y: event.screenY };
    canvas.setPointerCapture(event.pointerId);
    window.claudePet.dragStart();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!previous) return;
    const current = { x: event.screenX, y: event.screenY };
    window.claudePet.dragMove(current.x - previous.x, current.y - previous.y);
    previous = current;
  });
  canvas.addEventListener('pointerup', () => { previous = null; window.claudePet.dragEnd(); });
  canvas.addEventListener('pointercancel', () => { previous = null; window.claudePet.dragEnd(); });
}

async function startPetRenderer() {
  const canvas = document.querySelector('#pet');
  const context = canvas.getContext('2d');
  const manifest = await window.claudePet.getManifest();
  const machine = createPetStateMachine(manifest);
  const image = new Image();
  image.addEventListener('load', () => {
    const render = (timestamp) => {
      drawFrame(context, image, manifest, machine.getFrame(timestamp));
      window.requestAnimationFrame(render);
    };
    window.requestAnimationFrame(render);
  }, { once: true });
  image.src = manifest.spritesheetDataUrl;
  installWindowDrag(canvas);
  canvas.addEventListener('click', () => void window.claudePet.openApp());
  window.claudePet.onState((state) => machine.setState(state, performance.now()));
  canvas.addEventListener('drop', (event) => { event.preventDefault(); const file = event.dataTransfer?.files?.[0]; if (file) void window.claudePet.submitTextFile(file); });
  canvas.addEventListener('dragover', (event) => event.preventDefault());
}

if (typeof module !== 'undefined' && module.exports) module.exports = { drawFrame };
if (typeof window !== 'undefined' && window.claudePet) void startPetRenderer();
