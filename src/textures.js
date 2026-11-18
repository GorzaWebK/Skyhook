import * as THREE from 'three';
import { mulberry32 } from './rng.js';

// All textures are drawn in code on a canvas. No image files.

// Light concrete-ish panel with a grid. Tinted per material via color.
export function makePanelTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = mulberry32(7);

  g.fillStyle = '#d9d9d9';
  g.fillRect(0, 0, size, size);

  // Speckle noise.
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // Panel seams.
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(size / 2, 0); g.lineTo(size / 2, size);
  g.moveTo(0, size / 2); g.lineTo(size, size / 2);
  g.stroke();
  // Highlight edge.
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(4, 4); g.lineTo(size - 4, 4);
  g.moveTo(4, 4); g.lineTo(4, size - 4);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Hazard stripes for anchors, so they read as "grab me" from far away.
export function makeStripeTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#7a7a7a';
  for (let i = -size; i < size * 2; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - size, size);
    g.lineTo(i - size, size);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 6;
  g.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Tileable fractal noise, used as the alpha of the cloud sea.
export function makeCloudTexture(seed = 3) {
  const size = 256;
  const rand = mulberry32(seed);
  const octaves = [8, 16, 32, 64];
  const grids = octaves.map((n) => {
    const grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    return { n, grid };
  });
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = ({ n, grid }, u, v) => {
    const x = u * n;
    const y = v * n;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const at = (i, j) => grid[((j % n) + n) % n * n + (((i % n) + n) % n)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      for (const oct of grids) {
        v += sample(oct, x / size, y / size) * amp;
        amp *= 0.5;
      }
      const a = Math.max(0, Math.min(1, (v - 0.32) * 2.4));
      const i = (y * size + x) * 4;
      const shade = 225 + v * 30;
      img.data[i] = shade;
      img.data[i + 1] = shade;
      img.data[i + 2] = shade + 10;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
