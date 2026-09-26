import { renderPlateImage } from '../src/lib/export/card-image';
import './mobile-ui-baseline-capture.css';

const CAPTURE_ROOT = 'guides-raw/mobile-ui-phase0';

function mirrorFormValues(root: Element): () => void {
  const undo: (() => void)[] = [];
  for (const select of root.querySelectorAll('select')) {
    for (const option of select.options) {
      const had = option.hasAttribute('selected');
      if (option.selected === had) continue;
      if (option.selected) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
      undo.push(() =>
        had ? option.setAttribute('selected', '') : option.removeAttribute('selected')
      );
    }
  }
  for (const input of root.querySelectorAll('input')) {
    const prior = input.getAttribute('value');
    input.setAttribute('value', input.value);
    undo.push(() =>
      prior === null ? input.removeAttribute('value') : input.setAttribute('value', prior)
    );
  }
  for (const area of root.querySelectorAll('textarea')) {
    const prior = area.textContent;
    area.textContent = area.value;
    undo.push(() => {
      area.textContent = prior;
    });
  }
  return () => undo.forEach((restore) => restore());
}

function backdropOf(element: Element): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)$/.exec(colour);
    if (colour && colour !== 'transparent' && (!alpha || Number(alpha[1]) >= 1)) return colour;
  }
  return getComputedStyle(document.body).backgroundColor;
}

async function captureAppFrame(): Promise<string> {
  const frame = document.querySelector<HTMLElement>('.app-frame');
  if (!frame) throw new Error('The app frame is not ready.');

  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const params = new URLSearchParams(window.location.search);
  const view = params.get('mobile-baseline-view')?.replace(/[^a-z0-9-]/gi, '') || 'cards';
  const theme = document.documentElement.dataset['theme'] ?? 'system';
  const name = `${view}-${width}x${height}-${theme}`;

  const restore = mirrorFormValues(frame);
  let rendered: Blob;
  try {
    rendered = await renderPlateImage(
      frame,
      { label: 'Mobile UI baseline', mm: { width, height }, bleed: { width, height } },
      { bleed: true, width }
    );
  } finally {
    restore();
  }

  const bitmap = await createImageBitmap(rendered);
  const bitmapWidth = bitmap.width;
  const bitmapHeight = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = bitmapWidth;
  canvas.height = bitmapHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The baseline canvas is unavailable.');
  context.fillStyle = backdropOf(frame);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The baseline PNG could not be encoded.'))),
      'image/png'
    )
  );
  const path = `${CAPTURE_ROOT}/${name}.png`;
  const response = await fetch(`/__workshop/export?path=${path}`, { method: 'POST', body: png });
  if (!response.ok) throw new Error(await response.text());
  return `${path} — ${bitmapWidth}×${bitmapHeight}`;
}

function install(): void {
  const controls = document.createElement('aside');
  controls.className = 'mobile-baseline-controls';
  controls.setAttribute('aria-label', 'Mobile UI baseline capture');

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Capture baseline PNG';

  const status = document.createElement('output');
  status.textContent = 'Ready when the routed view has settled.';
  controls.append(button, status);
  document.body.append(controls);

  button.addEventListener('click', () => {
    button.disabled = true;
    status.textContent = 'Capturing…';
    document.documentElement.dataset['mobileBaselineCapture'] = 'running';
    void captureAppFrame()
      .then((result) => {
        status.textContent = result;
        document.documentElement.dataset['mobileBaselineCapture'] = 'done';
      })
      .catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Capture failed.';
        document.documentElement.dataset['mobileBaselineCapture'] = 'failed';
      })
      .finally(() => {
        button.disabled = false;
      });
  });
}

install();
