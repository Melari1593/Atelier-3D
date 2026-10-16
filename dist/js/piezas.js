// Geometría real para las piezas basadas en silueta: cortador de galletas, llavero y placa.
// Usa el conversor de Cookie-cutter (js/cookie-cutter.js) y earcut (js/earcut.min.js).
(function (global) {
  'use strict';
  const CC = global.CookieCutter;
  const RES = 8; // píxeles por milímetro de la rejilla de trabajo
  const ANALYSIS_SIZE = 1024;
  const MIN_AREA = 4; // mm²: manchas más pequeñas se descartan
  const RELIEF = 2; // mm de relieve de la silueta sobre la placa

  // ---------- Carga de imágenes ----------

  /** Asegura que un SVG tenga ancho y alto explícitos para poder dibujarlo en un canvas. */
  async function svgToUrl(file) {
    const doc = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
      throw new Error('El SVG no es válido.');
    }
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const attr = (n) => {
      const v = svg.getAttribute(n);
      return v && !v.endsWith('%') ? parseFloat(v) : NaN;
    };
    let w = attr('width'), h = attr('height');
    if (!(w > 0 && h > 0)) {
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; } else { w = h = ANALYSIS_SIZE; }
    }
    const k = 2048 / Math.max(w, h);
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', String(w * k));
    svg.setAttribute('height', String(h * k));
    return URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  }

  /** Carga un archivo de imagen (JPEG, PNG, SVG…) y devuelve { img, w, h, url }. */
  async function loadImage(file) {
    const isSvg = /\.svg$/i.test(file.name) || file.type === 'image/svg+xml';
    const url = isSvg ? await svgToUrl(file) : URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      el.src = url;
    });
    return { img, url, w: img.naturalWidth || ANALYSIS_SIZE, h: img.naturalHeight || ANALYSIS_SIZE };
  }

  function draw(img, sx, sy, sw, sh, dw, dh) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(dw));
    canvas.height = Math.max(1, Math.round(dh));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Máscara de la figura de la imagen, escalada para caber en maxW × maxH píxeles
   * conservando la proporción. Devuelve { mask, w, h }.
   */
  function imageMask(source, maxW, maxH, { threshold, invert }) {
    const k = ANALYSIS_SIZE / Math.max(source.w, source.h);
    const aw = Math.max(1, Math.round(source.w * k)), ah = Math.max(1, Math.round(source.h * k));
    const { mask: aMask, usedAlpha } = CC.computeMask(draw(source.img, 0, 0, source.w, source.h, aw, ah), { threshold, invert, mode: 'auto' });
    const box = CC.maskBounds(aMask, aw, ah);
    if (!box) throw new Error('No se detectó ninguna figura en la imagen. Ajusta el umbral o usa «Invertir».');
    const scale = Math.min(maxW / box.w, maxH / box.h);
    const data = draw(source.img, box.x / k, box.y / k, box.w / k, box.h / k, box.w * scale, box.h * scale);
    // El método de detección se fija en el análisis para que ambas pasadas coincidan.
    const { mask } = CC.computeMask(data, { threshold, invert, mode: usedAlpha ? 'alpha' : 'brightness' });
    return { mask: CC.fillHoles(mask, data.width, data.height), w: data.width, h: data.height };
  }

  // ---------- Operaciones sobre máscaras ----------

  function grid(w, h) { return { mask: new Uint8Array(w * h), w, h }; }

  function blit(dst, src, ox, oy) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        if (src.mask[y * src.w + x]) dst.mask[(y + oy) * dst.w + x + ox] = 1;
      }
    }
  }

  function disc(g, cx, cy, r, value) {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(g.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(g.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) g.mask[y * g.w + x] = value;
      }
    }
  }

  function roundedRect(g, x0, y0, rw, rh, r) {
    r = Math.min(r, rw / 2, rh / 2);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const dx = Math.max(r - (x + 0.5), 0, x + 0.5 - (rw - r));
        const dy = Math.max(r - (y + 0.5), 0, y + 0.5 - (rh - r));
        if (dx * dx + dy * dy <= r * r) g.mask[(y + y0) * g.w + x + x0] = 1;
      }
    }
  }

  /** Punto superior de la figura: centro de los píxeles de la primera fila ocupada. */
  function topCenter(g) {
    for (let y = 0; y < g.h; y++) {
      let sum = 0, n = 0;
      for (let x = 0; x < g.w; x++) if (g.mask[y * g.w + x]) { sum += x; n++; }
      if (n) return { x: sum / n, y };
    }
    return { x: g.w / 2, y: 0 };
  }

  function polygons(g) {
    return CC.maskToPolygons(g.mask, g.w, g.h, { res: RES, cx: g.w / 2, cy: g.h / 2, minAreaMM2: MIN_AREA });
  }

  // ---------- Piezas ----------

  /**
   * Genera las capas de la pieza.
   * tool: 'cortador' | 'llavero' | 'placa'
   * p (mm salvo indicación): width, height, depth, soft, hole, wall, flange, threshold, invert
   * source: imagen cargada con loadImage, o null.
   * Devuelve [{ name, polygons, z0, z1 }].
   */
  function build(tool, p, source) {
    const W = Math.round(p.width * RES), H = Math.round(p.height * RES);
    const detect = { threshold: p.threshold, invert: p.invert };

    if (tool === 'cortador') {
      if (!source) throw new Error('Sube un molde (JPEG, PNG o SVG) para generar el cortador.');
      const shape = imageMask(source, W, H, detect);
      const pad = Math.ceil(Math.max(p.wall, p.flange) * RES) + 4;
      const g = grid(shape.w + 2 * pad, shape.h + 2 * pad);
      blit(g, shape, pad, pad);
      return CC.buildLayers(g.mask, g.w, g.h, RES, {
        mode: 'cutter', height: p.depth, wall: p.wall, flangeWidth: p.flange,
        flangeHeight: Math.min(1.5, p.depth / 3), fillHoles: true, minArea: MIN_AREA,
      }).layers;
    }

    if (tool === 'llavero') {
      const ringR = 5 * RES, holeR = 2.2 * RES; // anilla de 10 mm con orificio de 4,4 mm
      const pad = ringR + 4;
      let shape;
      if (source) {
        shape = imageMask(source, W, H, detect);
      } else {
        shape = grid(W, H);
        roundedRect(shape, 0, 0, W, H, (p.soft ? 0.3 : 0.05) * Math.min(W, H));
      }
      const g = grid(shape.w + 2 * pad, shape.h + 2 * pad);
      blit(g, shape, pad, pad);
      // Anilla centrada sobre el punto más alto de la figura, sobresaliendo por arriba.
      const top = topCenter(shape);
      const cx = pad + top.x, cy = pad + top.y - 0.15 * ringR;
      disc(g, cx, cy, ringR, 1);
      disc(g, cx, cy, holeR, 0);
      return [{ name: 'llavero', polygons: polygons(g), z0: 0, z1: p.depth }];
    }

    if (tool === 'placa') {
      const pad = 4;
      const base = grid(W + 2 * pad, H + 2 * pad);
      roundedRect(base, pad, pad, W, H, (p.soft ? 6 : 1) * RES);
      const holeR = 2.5 * RES, holeX = base.w / 2, holeY = pad + 6 * RES;
      if (p.hole) disc(base, holeX, holeY, holeR, 0);
      const layers = [{ name: 'placa', polygons: polygons(base), z0: 0, z1: p.depth }];
      if (source) {
        // Relieve de la silueta sobre la placa, con un margen del 12 %.
        const margin = 0.12 * Math.min(W, H);
        const shape = imageMask(source, W - 2 * margin, H - 2 * margin, detect);
        const relief = grid(base.w, base.h);
        blit(relief, shape, Math.round((base.w - shape.w) / 2), Math.round((base.h - shape.h) / 2));
        if (p.hole) disc(relief, holeX, holeY, holeR + 1.5 * RES, 0);
        const reliefPolys = polygons(relief);
        if (reliefPolys.length) layers.push({ name: 'relieve', polygons: reliefPolys, z0: p.depth, z1: p.depth + RELIEF });
      }
      return layers;
    }

    throw new Error(`Pieza desconocida: ${tool}`);
  }

  // ---------- Medidas ----------

  function bounds(layers) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
    for (const l of layers) {
      if (l.polygons.length) maxZ = Math.max(maxZ, l.z1);
      for (const poly of l.polygons) {
        for (const [x, y] of poly.outer) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY, x: maxX - minX, y: maxY - minY, z: maxZ };
  }

  // ---------- STL ----------

  /** Triángulos [ax,ay,az, bx,by,bz, cx,cy,cz] de todas las capas, con normales hacia fuera. */
  function triangles(layers) {
    const tris = [];
    for (const { polygons: polys, z0, z1 } of layers) {
      for (const { outer, holes } of polys) {
        const rings = [outer, ...holes];
        const flat = [];
        const holeIdx = [];
        rings.forEach((ring, i) => {
          if (i > 0) holeIdx.push(flat.length / 2);
          for (const [x, y] of ring) flat.push(x, y);
        });
        const idx = global.earcut(flat, holeIdx, 2);
        const P = (i, z) => [flat[2 * i], flat[2 * i + 1], z];
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t];
          let b = idx[t + 1], c = idx[t + 2];
          const ax = flat[2 * a], ay = flat[2 * a + 1];
          const cross = (flat[2 * b] - ax) * (flat[2 * c + 1] - ay) - (flat[2 * b + 1] - ay) * (flat[2 * c] - ax);
          if (cross < 0) [b, c] = [c, b]; // antihorario visto desde arriba
          tris.push([...P(a, z1), ...P(b, z1), ...P(c, z1)]); // tapa superior
          tris.push([...P(a, z0), ...P(c, z0), ...P(b, z0)]); // tapa inferior
        }
        // Paredes: contornos exteriores antihorarios y huecos horarios dejan la normal hacia fuera.
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
            tris.push([ax, ay, z0, bx, by, z0, bx, by, z1]);
            tris.push([ax, ay, z0, bx, by, z1, ax, ay, z1]);
          }
        }
      }
    }
    return tris;
  }

  /** STL binario (ArrayBuffer) con la pieza apoyada en z = 0 y centrada en XY. */
  function toSTL(layers) {
    const tris = triangles(layers);
    const buf = new ArrayBuffer(84 + 50 * tris.length);
    const dv = new DataView(buf);
    const header = 'Atelier 3D - generado en el navegador';
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, tris.length, true);
    let o = 84;
    for (const t of tris) {
      const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2];
      const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      for (const n of [nx / len, ny / len, nz / len]) { dv.setFloat32(o, n, true); o += 4; }
      for (const v of t) { dv.setFloat32(o, v, true); o += 4; }
      o += 2; // atributo sin uso
    }
    return buf;
  }

  // ---------- Vista previa SVG ----------

  function pathData(polys) {
    let d = '';
    for (const { outer, holes } of polys) {
      for (const ring of [outer, ...holes]) {
        d += ring.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
      }
    }
    return d;
  }

  /**
   * Dibujo de la pieza en perspectiva caballera para el viewBox 500 × 430 de Atelier.
   * colors: { face, side, top }
   */
  function previewSVG(layers, colors) {
    const b = bounds(layers);
    if (!b) return '';
    const lift = 0.55; // desplazamiento vertical en pantalla por mm de altura
    const s = Math.min(400 / b.x, 320 / (b.y + b.z * lift), 6);
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const midY = 210 + (b.z * lift * s) / 2;
    const at = (z) => `translate(${(250 - s * cx).toFixed(2)} ${(midY + s * cy - z * lift * s).toFixed(2)}) scale(${s.toFixed(4)} ${(-s).toFixed(4)})`;
    let out = `<ellipse cx="250" cy="${Math.min(412, midY + (s * b.y) / 2 + 12).toFixed(1)}" rx="${Math.min(235, (s * b.x) / 2 + 20).toFixed(1)}" ry="16" fill="#557568" opacity=".12"/>`;
    for (const l of layers) {
      if (!l.polygons.length) continue;
      const d = pathData(l.polygons);
      const steps = Math.max(2, Math.min(14, Math.round(((l.z1 - l.z0) * lift * s) / 2)));
      for (let i = 0; i < steps; i++) {
        out += `<path d="${d}" fill="${colors.side}" fill-rule="evenodd" transform="${at(l.z0 + ((l.z1 - l.z0) * i) / steps)}"/>`;
      }
      const fill = l.name === 'pestaña' ? colors.face : colors.top;
      out += `<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${colors.side}" stroke-width="${(1.2 / s).toFixed(3)}" transform="${at(l.z1)}"/>`;
    }
    return out;
  }

  global.AtelierPiezas = { loadImage, build, bounds, toSTL, triangles, previewSVG, RES };
})(window);
