import * as THREE from 'three';
import { noise } from './lunar-terrain';
import { QUALITY_SETTINGS, type QualityLevel } from './scene-settings';

function randomGenerator(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeRocks(
  groundMaterial: THREE.MeshStandardMaterial,
  heightAt: (x: number, z: number) => number,
  quality: QualityLevel,
) {
  const random = randomGenerator(317);
  const settings = QUALITY_SETTINGS[quality];
  const group = new THREE.Group();
  group.name = 'Lunar rock tiles';
  const material = groundMaterial.clone();
  material.color.setHex(0xa4a3a1);
  material.normalScale.set(1.2, 1.2);
  material.vertexColors = false;
  const dummy = new THREE.Object3D();
  for (let variant = 0; variant < 5; variant++) {
    const geometry = new THREE.IcosahedronGeometry(1, settings.rockDetail);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        y = positions.getY(i),
        z = positions.getZ(i);
      const scale = 0.75 + noise(x * 4 + variant * 7, z * 4 + y * 3) * 0.45;
      positions.setXYZ(i, x * scale, y * scale, z * scale);
    }
    geometry.computeVertexNormals();
    const tiles = new Map<
      number,
      { matrix: THREE.Matrix4; color: THREE.Color }[]
    >();
    const total = variant === 0 ? 800 : 290;
    for (let i = 0; i < total; i++) {
      let x = 0,
        z = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        x = (random() - 0.5) * 174;
        z = (random() - 0.5) * 174;
        if (
          Math.abs(Math.hypot(x - 18, z) - 18) > 2.2 &&
          Math.hypot(x, z) > 2.6
        )
          break;
      }
      const size =
        variant === 0
          ? 0.018 + random() ** 2 * 0.12
          : 0.06 + random() ** 4 * 0.85;
      dummy.position.set(x, heightAt(x, z) + size * 0.12, z);
      dummy.rotation.set(random() * 2, random() * Math.PI * 2, random() * 2);
      dummy.scale.set(
        size * (1 + random() * 0.65),
        size * (0.45 + random() * 0.4),
        size * (1 + random() * 0.3),
      );
      const color = new THREE.Color().setScalar(0.67 + random() * 0.39);
      // Consume the same seeded sequence in every quality level so remaining
      // stones stay in place when switching between levels.
      if (i >= Math.floor(total * settings.rockFraction)) continue;
      dummy.updateMatrix();
      const key = Math.floor((x + 87) / 58) + 3 * Math.floor((z + 87) / 58);
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key)!.push({ matrix: dummy.matrix.clone(), color });
    }
    for (const instances of tiles.values()) {
      const mesh = new THREE.InstancedMesh(
        geometry,
        material,
        instances.length,
      );
      instances.forEach((instance, index) => {
        mesh.setMatrixAt(index, instance.matrix);
        mesh.setColorAt(index, instance.color);
      });
      mesh.castShadow = quality !== 'low' || variant > 0;
      mesh.receiveShadow = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

/** Ground textures are shared with the terrain and must survive a rock rebuild. */
export function disposeRocks(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      geometries.add(object.geometry);
      materials.add(object.material as THREE.Material);
      object.dispose();
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function makeSurfaceDetail(kind: 'foil' | 'cells') {
  const size = 256,
    data = new Uint8Array(size * size * 4);
  const random = randomGenerator(730);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (kind === 'foil') {
        const u = x / size,
          v = y / size;
        const folds =
          Math.sin(u * 43 + Math.sin(v * 27) * 3) * 0.2 +
          Math.sin(v * 37 + Math.sin(u * 23) * 4) * 0.18;
        const ridge =
          Math.pow(
            Math.abs(Math.sin(u * 61 + v * 21 + Math.sin(v * 17) * 2)),
            12,
          ) * 0.22;
        const value = Math.round(
          THREE.MathUtils.clamp(
            0.5 + folds + ridge + (random() - 0.5) * 0.13,
            0,
            1,
          ) * 255,
        );
        data[i] = data[i + 1] = data[i + 2] = value;
      } else {
        const border = x < 3 || y < 4 || x > 252 || y > 251;
        const conductor = x % 32 < 1 || x === 85 || x === 171;
        const grain = random() * 9;
        data[i] = border ? 112 : conductor ? 67 : 21 + grain;
        data[i + 1] = border ? 113 : conductor ? 78 : 34 + grain;
        data[i + 2] = border ? 108 : conductor ? 91 : 57 + grain;
      }
      data[i + 3] = 255;
    }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.repeat.set(kind === 'foil' ? 4 : 7, kind === 'foil' ? 4 : 10);
  if (kind === 'cells') map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  return map;
}

export function makeStars(scene: THREE.Scene) {
  const random = randomGenerator(1989);
  const positions: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < 1800; i++) {
    const y = random() * 1.3 - 0.15;
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions.push(
      Math.cos(angle) * r * 2200,
      y * 2200,
      Math.sin(angle) * r * 2200,
    );
    const brightness = 0.15 + Math.pow(random(), 6) * 0.7;
    colors.push(brightness * 0.91, brightness * 0.94, brightness);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.85,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  stars.name = 'Distant stars';
  scene.add(stars);
}
