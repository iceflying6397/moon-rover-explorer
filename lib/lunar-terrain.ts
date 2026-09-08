import * as THREE from 'three';

export type TerrainQuality = 'low' | 'standard' | 'high';
export type TerrainHeightSampler = (x: number, z: number) => number;

// Every ring shares its boundary vertices with its neighbours. The central
// square includes all craters and the driving route, at the highest density.
const INNER_RADIUS = 96;
const OUTER_RADIUS = 1100;
export const TERRAIN_QUALITY = {
  low: { segments: 96, radialStep: 24 },
  standard: { segments: 192, radialStep: 16 },
  high: { segments: 256, radialStep: 12 },
} as const;

const hash = (x: number, z: number) => {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

export function noise(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const u = fx * fx * (3 - 2 * fx),
    v = fz * fz * (3 - 2 * fz);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u),
    v,
  );
}

export function fbm(x: number, z: number, octaves = 5) {
  let sum = 0,
    amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x, z);
    x = x * 2.07 + 17.3;
    z = z * 2.07 - 11.8;
    amp *= 0.5;
  }
  return sum;
}

const craters = [
  { x: -18, z: -16, r: 8.5, d: 2.1 },
  { x: 27, z: -33, r: 12, d: 3.1 },
  { x: -32, z: 22, r: 5.5, d: 1.25 },
  { x: 53, z: 47, r: 14, d: 3 },
  { x: -63, z: -62, r: 24, d: 6 },
  { x: 7, z: -54, r: 13, d: 3.2 },
  { x: 56, z: -48, r: 7, d: 2 },
  { x: -7, z: 48, r: 5, d: 1.1 },
];

/** Original procedural shape. Use a terrain instance's heightAt for contact. */
export function lunarElevation(x: number, z: number) {
  const farBlend = THREE.MathUtils.smoothstep(Math.hypot(x, z), 45, 155);
  let y = (fbm(x * 0.065 + 73, z * 0.065 + 19) - 0.48) * 1.15;
  y += (noise(x * 0.62, z * 0.62) - 0.5) * 0.035;
  y += farBlend * (fbm(x * 0.012 + 12, z * 0.012 + 42, 6) - 0.3) * 49;
  y +=
    farBlend *
    Math.pow(Math.abs(noise(x * 0.005 + 36, z * 0.005 - 28) - 0.5) * 2, 2) *
    32;
  for (const c of craters) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d > 1.6) continue;
    const bowl = -c.d * Math.pow(Math.max(0, 1 - d * d), 2);
    const rim = c.d * 0.22 * Math.exp(-Math.pow((d - 1.02) / 0.14, 2));
    y += bowl + rim * (0.85 + 0.3 * noise(x * 0.9, z * 0.9));
  }
  return y;
}

export type LunarTerrainData = {
  positions: Float32Array;
  indices: Uint32Array;
  colors: Float32Array;
  uv: Float32Array;
  heightAt: TerrainHeightSampler;
};

/** Creates CPU data without a scene, renderer, browser, or GPU. */
export function createLunarTerrainData(
  quality: TerrainQuality = 'standard',
): LunarTerrainData {
  const { segments, radialStep } = TERRAIN_QUALITY[quality];
  const stride = segments + 1;
  const innerVertices = stride * stride;
  const ringVertices = 4 * segments;
  const ringCount = Math.ceil((OUTER_RADIUS - INNER_RADIUS) / radialStep);
  const ringStep = (OUTER_RADIUS - INNER_RADIUS) / ringCount;
  const coreStep = (INNER_RADIUS * 2) / segments;
  const vertexCount = innerVertices + ringCount * ringVertices;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(
    (segments * segments + ringCount * ringVertices) * 6,
  );
  const radii = new Float32Array(ringCount + 1);

  const setVertex = (index: number, x: number, z: number) => {
    // Store the horizontal coordinates first: rendering and height sampling
    // then use the same Float32 values, including at distant ring boundaries.
    positions[index * 3] = x;
    positions[index * 3 + 2] = z;
    x = positions[index * 3];
    z = positions[index * 3 + 2];
    positions[index * 3 + 1] = lunarElevation(x, z);
    const c = 0.67 + fbm(x * 0.36 + 21, z * 0.36) * 0.36;
    colors[index * 3] = c;
    colors[index * 3 + 1] = c * 0.995;
    colors[index * 3 + 2] = c * 0.976;
    uv[index * 2] = x / 3.5;
    uv[index * 2 + 1] = z / 3.5;
  };
  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      setVertex(
        row * stride + col,
        -INNER_RADIUS + col * coreStep,
        -INNER_RADIUS + row * coreStep,
      );
    }
  }

  // Corners appear only once on each perimeter. Ring 0 reuses the central
  // grid's actual boundary indices, so normals also remain continuous.
  const perimeterIndex = (ring: number, side: number, segment: number) => {
    const offset = (side * segments + segment) % ringVertices;
    if (ring > 0) return innerVertices + (ring - 1) * ringVertices + offset;
    const edge = Math.floor(offset / segments),
      j = offset % segments;
    if (edge === 0) return j;
    if (edge === 1) return j * stride + segments;
    if (edge === 2) return segments * stride + segments - j;
    return (segments - j) * stride;
  };
  radii[0] = INNER_RADIUS;
  for (let ring = 1; ring <= ringCount; ring++) {
    radii[ring] = INNER_RADIUS + ring * ringStep;
    const radius = radii[ring];
    for (let j = 0; j < segments; j++) {
      const p = (-1 + (2 * j) / segments) * radius;
      setVertex(perimeterIndex(ring, 0, j), p, -radius);
      setVertex(perimeterIndex(ring, 1, j), radius, p);
      setVertex(perimeterIndex(ring, 2, j), -p, radius);
      setVertex(perimeterIndex(ring, 3, j), -radius, -p);
    }
  }

  let nextIndex = 0;
  const addTriangle = (a: number, b: number, c: number) => {
    const ax = positions[a * 3],
      az = positions[a * 3 + 2];
    const bx = positions[b * 3],
      bz = positions[b * 3 + 2];
    const cx = positions[c * 3],
      cz = positions[c * 3 + 2];
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    indices[nextIndex++] = a;
    indices[nextIndex++] = up > 0 ? b : c;
    indices[nextIndex++] = up > 0 ? c : b;
  };
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * stride + col,
        b = a + 1,
        c = a + stride,
        d = c + 1;
      addTriangle(a, c, b);
      addTriangle(b, c, d);
    }
  }
  for (let ring = 0; ring < ringCount; ring++) {
    for (let side = 0; side < 4; side++) {
      for (let j = 0; j < segments; j++) {
        const a = perimeterIndex(ring, side, j),
          b = perimeterIndex(ring, side, j + 1);
        const c = perimeterIndex(ring + 1, side, j),
          d = perimeterIndex(ring + 1, side, j + 1);
        addTriangle(a, c, b);
        addTriangle(b, c, d);
      }
    }
  }

  const sampleQuad = (index: number, x: number, z: number) => {
    for (let triangle = 0; triangle < 2; triangle++) {
      const offset = index + triangle * 3;
      const a = indices[offset] * 3,
        b = indices[offset + 1] * 3,
        c = indices[offset + 2] * 3;
      const ax = positions[a],
        az = positions[a + 2],
        bx = positions[b],
        bz = positions[b + 2];
      const cx = positions[c],
        cz = positions[c + 2];
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
      const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
      const wc = 1 - wa - wb;
      if (triangle === 1 || (wa >= -1e-10 && wb >= -1e-10 && wc >= -1e-10)) {
        return (
          wa * positions[a + 1] + wb * positions[b + 1] + wc * positions[c + 1]
        );
      }
    }
    return 0;
  };

  const heightAt: TerrainHeightSampler = (x, z) => {
    x = THREE.MathUtils.clamp(x, -OUTER_RADIUS, OUTER_RADIUS);
    z = THREE.MathUtils.clamp(z, -OUTER_RADIUS, OUTER_RADIUS);
    const radius = Math.max(Math.abs(x), Math.abs(z));
    if (radius <= INNER_RADIUS) {
      const col = Math.min(
        segments - 1,
        Math.floor((x + INNER_RADIUS) / coreStep),
      );
      const row = Math.min(
        segments - 1,
        Math.floor((z + INNER_RADIUS) / coreStep),
      );
      return sampleQuad((row * segments + col) * 6, x, z);
    }
    let ring = Math.min(
      ringCount - 1,
      Math.floor((radius - INNER_RADIUS) / ringStep),
    );
    // Rounding a radius to Float32 may put a boundary just across the estimate.
    if (radius < radii[ring]) ring--;
    else if (radius > radii[ring + 1]) ring++;
    let side: number, minor: number;
    if (z <= -Math.abs(x)) {
      side = 0;
      minor = x;
    } else if (x >= Math.abs(z)) {
      side = 1;
      minor = z;
    } else if (z >= Math.abs(x)) {
      side = 2;
      minor = -x;
    } else {
      side = 3;
      minor = -z;
    }
    let segment = Math.min(
      segments - 1,
      Math.max(0, Math.floor(((minor / radius + 1) * segments) / 2)),
    );
    const radialFraction =
      (radius - radii[ring]) / (radii[ring + 1] - radii[ring]);
    const axis = side % 2 === 0 ? 0 : 2;
    const sign = side < 2 ? 1 : -1;
    const edgeAt = (j: number) => {
      const a = positions[perimeterIndex(ring, side, j) * 3 + axis] * sign;
      const b = positions[perimeterIndex(ring + 1, side, j) * 3 + axis] * sign;
      return a + radialFraction * (b - a);
    };
    // Match the stored edge, including Float32 rounding, rather than an ideal
    // radial line. This correction checks at most one adjacent segment.
    if (segment > 0 && minor < edgeAt(segment)) segment--;
    else if (segment < segments - 1 && minor > edgeAt(segment + 1)) segment++;
    const quad =
      segments * segments + ring * ringVertices + side * segments + segment;
    return sampleQuad(quad * 6, x, z);
  };

  return { positions, indices, colors, uv, heightAt };
}

export function createLunarTerrain(
  material: THREE.Material,
  quality: TerrainQuality = 'standard',
) {
  const data = createLunarTerrainData(quality);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(data.positions, 3),
  );
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
  geometry.setAttribute('uv1', geometry.attributes.uv.clone());
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'Lunar regolith';
  return { mesh, heightAt: data.heightAt };
}
