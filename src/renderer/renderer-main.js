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
  installProgressRing();
  installAttentionBadge();
}

// Phase 3 Task 4 sub-branch 3: render the run-progress ring around the pet.
// Pure geometry comes from petWindowEffects (same source as the ribbon); this is
// a thin DOM adapter over the #pet-ring SVG path.
function installProgressRing() {
  const fx = typeof petWindowEffects !== 'undefined' ? petWindowEffects : null;
  const ringEl = document.querySelector('#pet-ring');
  if (!fx || !ringEl || typeof window.claudePet.onProgress !== 'function') return;
  window.claudePet.onProgress((progress) => {
    const vm = fx.ringViewModel({ progress });
    if (vm.visible) {
      ringEl.setAttribute('d', vm.path);
      ringEl.style.display = '';
    } else {
      ringEl.style.display = 'none';
    }
  });
}

// Phase 3 Task 4 sub-branch 3: render the sign-in / failure attention badge.
// A polite live region (#pet-badge) so a blocked run is announced even with the
// main window closed; tone (info/danger) drives the badge color via CSS.
function installAttentionBadge() {
  const fx = typeof petWindowEffects !== 'undefined' ? petWindowEffects : null;
  const badgeEl = document.querySelector('#pet-badge');
  if (!fx || !badgeEl || typeof window.claudePet.onAttention !== 'function') return;
  const glyphEl = badgeEl.querySelector('#pet-badge-glyph');
  window.claudePet.onAttention(({ attention, label }) => {
    const vm = fx.attentionBadge({ attention, label });
    if (vm.visible) {
      badgeEl.setAttribute('data-tone', vm.tone);
      badgeEl.setAttribute('aria-label', vm.label || '');
      if (glyphEl) glyphEl.textContent = vm.tone === 'danger' ? '!' : '?';
      badgeEl.style.display = '';
    } else {
      badgeEl.removeAttribute('data-tone');
      badgeEl.removeAttribute('aria-label');
      badgeEl.style.display = 'none';
    }
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { drawFrame, installProgressRing, installAttentionBadge };
if (typeof window !== 'undefined' && window.claudePet) void startPetRenderer();
