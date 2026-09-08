import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// Browser-compatible binary export in Node; no remote assets are used.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;
      this.onloadend?.();
    });
  }
};
const root = path.resolve('assets-source/viper');
const loader = new OBJLoader();
const palette = {
  Default_OBJ: { color: 0xc5c9c8, metalness: 0.58, roughness: 0.39 },
  black: { color: 0x171c1d, metalness: 0.32, roughness: 0.6 },
  gold_foil: { color: 0xb99a53, metalness: 0.86, roughness: 0.42 },
  silver_foil: { color: 0xccccc6, metalness: 0.85, roughness: 0.36 },
  panel: { color: 0x172235, metalness: 0.7, roughness: 0.32 },
  wheel_metal: { color: 0x7c8283, metalness: 0.78, roughness: 0.52 },
  suspension: { color: 0xb6a17a, metalness: 0.78, roughness: 0.46 },
};
const materials = Object.fromEntries(
  Object.entries(palette).map(([name, config]) => [
    name,
    new THREE.MeshStandardMaterial({ ...config, name }),
  ]),
);
async function readPart(file, override) {
  const object = loader.parse(await fs.readFile(path.join(root, file), 'utf8'));
  object.traverse((item) => {
    if (!item.isMesh) return;
    const convert = (old) =>
      materials[override || old.name] || materials.Default_OBJ;
    item.material = Array.isArray(item.material)
      ? item.material.map(convert)
      : convert(item.material);
    // Triplanar-style UVs, evaluated per triangle, allow physically sized foil/cell textures.
    const pos = item.geometry.attributes.position;
    const normals = item.geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i += 3) {
      let nx = 0,
        ny = 0,
        nz = 0;
      for (let j = 0; j < 3; j++) {
        nx += normals.getX(i + j);
        ny += normals.getY(i + j);
        nz += normals.getZ(i + j);
      }
      nx = Math.abs(nx);
      ny = Math.abs(ny);
      nz = Math.abs(nz);
      for (let j = 0; j < 3; j++) {
        const k = i + j;
        uv[k * 2] = nx > ny && nx > nz ? pos.getY(k) : pos.getX(k);
        uv[k * 2 + 1] = nz > nx && nz > ny ? pos.getY(k) : pos.getZ(k);
      }
    }
    item.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
  return object;
}
const rover = new THREE.Group();
rover.name = 'VIPER_Chrono_Assembly_Z_UP';
rover.add(await readPart('render/chassis.obj'));
const wheel = await readPart('obj/viper_wheel.obj', 'wheel_metal');
for (const [name, front, side] of [
  ['LF', 1, 1],
  ['RF', 1, -1],
  ['LB', -1, 1],
  ['RB', -1, -1],
]) {
  const pivot = new THREE.Group();
  pivot.name = `wheel_${name}`;
  pivot.position.set(front * 0.6418, side * 0.6098, 0);
  const wheelModel = wheel.clone();
  wheelModel.name = `tread_${name}`;
  if (side === 1) wheelModel.rotation.z = Math.PI;
  pivot.add(wheelModel);
  rover.add(pivot);
  for (const [part, z] of [
    ['bt_sus', -0.0525],
    ['up_sus', 0.0525],
    ['steer', 0],
  ]) {
    const arm = await readPart(
      `render/${side === 1 ? 'l' : 'r'}_${part}.obj`,
      'suspension',
    );
    arm.name = `${part}_${name}`;
    arm.position.set(
      front * 0.6418,
      side * (part === 'steer' ? 0.6098 : 0.2067),
      z,
    );
    rover.add(arm);
  }
}
// Fine exposed fasteners on the lower structural rails.
const boltGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.006, 6);
boltGeo.rotateX(Math.PI / 2);
for (const side of [-1, 1])
  for (const x of [-0.56, -0.35, -0.14, 0.07, 0.28, 0.49]) {
    const bolt = new THREE.Mesh(boltGeo, materials.Default_OBJ);
    bolt.position.set(x, side * 0.3, 0.23);
    rover.add(bolt);
  }
rover.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(rover);
let faces = 0,
  meshes = 0;
rover.traverse((o) => {
  if (o.isMesh) {
    meshes++;
    faces +=
      (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
  }
});
const result = await new GLTFExporter().parseAsync(rover, {
  binary: true,
  onlyVisible: true,
});
await fs.writeFile('public/assets/rover/viper.glb', Buffer.from(result));
console.log(
  JSON.stringify(
    {
      bytes: result.byteLength,
      meshes,
      triangles: faces,
      bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    },
    null,
    2,
  ),
);
