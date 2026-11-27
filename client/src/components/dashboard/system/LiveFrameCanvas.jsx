import { useEffect, useImperativeHandle, useRef } from 'react';

function toFrameBlob(frame, mime) {
  if (typeof frame !== 'string') return new Blob([frame], { type: mime || 'image/jpeg' });

  const dataUri = frame.startsWith('data:');
  const separator = dataUri ? frame.indexOf(',') : -1;
  const header = dataUri ? frame.slice(5, separator) : '';
  if (dataUri && !/;base64$/i.test(header)) return fetch(frame).then(response => response.blob());

  const base64 = frame.slice(separator + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const type = header.split(';')[0] || mime || (base64.startsWith('iVBOR') ? 'image/png' : 'image/jpeg');
  return new Blob([bytes], { type });
}

async function decodeFrame(frame, mime) {
  const blob = await toFrameBlob(frame, mime);
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some image formats can only be decoded by the browser's image element.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LiveFrameCanvas({ frame, mime, onFrameStats, ref }) {
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  useImperativeHandle(ref, () => ({
    push: (...args) => streamRef.current?.push(...args),
    clear: () => streamRef.current?.clear(),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return;

    let pending = null;
    let busy = false;
    let cancelDraw;
    let generation = 0;
    let url = 'about:blank';
    let hasFrame = false;
    let frameTimes = [];
    let published;
    let fpsExpiry;

    async function drawNext() {
      if (busy || !pending) return;
      const next = pending;
      pending = null;
      busy = true;
      const drawGeneration = generation;
      let bitmap;

      try {
        bitmap = await decodeFrame(next.frame, next.mime);
        if (drawGeneration !== generation) return;

        await new Promise((resolve, reject) => {
          const id = requestAnimationFrame(() => {
            cancelDraw = undefined;
            try {
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              context.clearRect(0, 0, canvas.width, canvas.height);
              context.drawImage(bitmap, 0, 0);
              canvas.style.visibility = 'visible';
              hasFrame = true;
              resolve();
            } catch (error) {
              reject(error);
            }
          });
          cancelDraw = () => {
            cancelAnimationFrame(id);
            resolve();
          };
        });
      } catch {
        // A failed decode leaves the previous frame on screen.
      } finally {
        bitmap?.close?.();
        busy = false;
        drawNext();
      }
    }

    const clear = () => {
      generation++;
      pending = null;
      cancelDraw?.();
      cancelDraw = undefined;
      context.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.visibility = 'hidden';
      url = 'about:blank';
      hasFrame = false;
      frameTimes = [];
      clearTimeout(fpsExpiry);
    };

    streamRef.current = {
      push(nextFrame, nextMime, nextUrl) {
        if (nextFrame == null) return;
        pending = { frame: nextFrame, mime: nextMime };
        if (typeof nextUrl === 'string' && nextUrl) url = nextUrl;
        frameTimes.push(performance.now());
        drawNext();
      },
      clear,
    };

    const timer = setInterval(() => {
      const now = performance.now();
      frameTimes = frameTimes.filter(time => now - time < 1000);
      const stats = { url, fps: frameTimes.length, hasFrame };
      if (stats.url !== published?.url || stats.fps !== published?.fps || stats.hasFrame !== published?.hasFrame) {
        published = stats;
        onFrameStats?.(stats);
      }
      clearTimeout(fpsExpiry);
      if (stats.fps > 0) {
        const expiresAt = frameTimes.at(-1) + 1000;
        fpsExpiry = setTimeout(() => {
          if (frameTimes.at(-1) + 1000 > expiresAt) return;
          published = { ...published, fps: 0 };
          onFrameStats?.(published);
        }, expiresAt - now);
      }
    }, 500);

    return () => {
      streamRef.current = null;
      clearInterval(timer);
      clear();
    };
  }, [onFrameStats]);

  useEffect(() => {
    if (frame === null) streamRef.current?.clear();
    else if (frame !== undefined) streamRef.current?.push(frame, mime);
  }, [frame, mime]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Live browser view"
      className="invisible block h-auto max-h-full w-full object-contain"
      style={{ aspectRatio: 'auto 16 / 9', imageRendering: 'auto' }}
    />
  );
}
