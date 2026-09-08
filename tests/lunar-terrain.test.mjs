import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  createLunarTerrain,
  createLunarTerrainData,
  TERRAIN_QUALITY,
} from '../lib/lunar-terrain.ts';

function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const quality of ['low', 'standard', 'high']) {
  test(`${quality}: contact heights match the rendered triangles and every seam`, () => {
    const material = new THREE.MeshBasicMaterial();
    const terrain = createLunarTerrain(material, quality);
    const { mesh, heightAt } = terrain;
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(),
      new THREE.Vector3(0, -1, 0),
    );
    const points = [
      [0, 0],
      [-231.28, 269.57],
      [-91, 77.5],
      [-18, -16],
      [27, -33],
      [-63, -62],
      [-96, -96],
      [96, -96],
      [96, 96],
      [-96, 96],
      [-1100, -1100],
      [1100, -1100],
      [1100, 1100],
      [-1100, 1100],
    ];
    const random = randomGenerator(20260907);
    for (let i = 0; i < 64; i++)
      points.push([(random() - 0.5) * 2000, (random() - 0.5) * 2000]);
    // The old near/far overlap, new shared edge, and square-ring corners.
    for (const radius of [96 - 1e-7, 96, 96 + 1e-7, 107.95237731933594, 350]) {
      for (const sign of [-1, 1]) {
        points.push([radius * sign, 77.5], [77.5, radius * sign]);
        points.push([radius * sign, radius], [radius * sign, -radius]);
      }
    }
    // Sample the exact Float32 radial/diagonal edges and adjacent points.
    const positions = mesh.geometry.attributes.position;
    const core = (TERRAIN_QUALITY[quality].segments + 1) ** 2;
    for (const index of [
      core,
      core + 1,
      Math.floor((core + positions.count) / 2),
      positions.count - 1,
    ]) {
      const x = positions.getX(index),
        z = positions.getZ(index);
      for (const epsilon of [-1e-7, 0, 1e-7]) {
        points.push([THREE.MathUtils.clamp(x + epsilon, -1100, 1100), z]);
      }
    }
    let maximumError = 0;
    for (const [x, z] of points) {
      ray.ray.origin.set(x, 500, z);
      const intersections = ray.intersectObject(mesh, false);
      assert.ok(
        intersections.length > 0,
        `${quality}: missing terrain at ${x}, ${z}`,
      );
      const expected = intersections[0].point.y;
      const error = Math.abs(expected - heightAt(x, z));
      maximumError = Math.max(maximumError, error);
      assert.ok(
        error < 1e-7,
        `${quality}: contact differs by ${error} at ${x}, ${z}`,
      );
      const layers = [
        ...new Set(intersections.map((hit) => Math.round(hit.point.y * 1e6))),
      ];
      assert.equal(
        layers.length,
        1,
        `${quality}: overlapping terrain layers at ${x}, ${z}`,
      );
    }
    const normals = mesh.geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) {
      assert.ok(
        Number.isFinite(normals.getX(i)) &&
          normals.getY(i) > 0 &&
          Number.isFinite(normals.getZ(i)),
      );
    }
    console.log(
      `${quality}: ${mesh.geometry.index.count / 3} triangles, ${points.length} rays, max contact error ${maximumError} m`,
    );
    mesh.geometry.dispose();
    material.dispose();
  });
}

test('all triangles have exactly matching contact heights, no interior cracks, and no overlap', () => {
  const { positions, indices, heightAt } = createLunarTerrainData('low');
  const edges = new Map();
  let area = 0,
    maxError = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    const x = (positions[a] + positions[b] + positions[c]) / 3;
    const z = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    const y = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    const error = Math.abs(heightAt(x, z) - y);
    maxError = Math.max(maxError, error);
    assert.ok(
      error < 1e-7,
      `triangle ${i / 3}: expected ${y}, got ${heightAt(x, z)}`,
    );
    const up =
      (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) -
      (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
    assert.ok(up > 0, `triangle ${i / 3} is folded or degenerate`);
    area += up / 2;
    for (const [u, v] of [
      [indices[i], indices[i + 1]],
      [indices[i + 1], indices[i + 2]],
      [indices[i + 2], indices[i]],
    ]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assert.ok(
    Math.abs(area - 2200 ** 2) < 1e-6,
    `wrong total terrain area: ${area}`,
  );
  let boundaryEdges = 0;
  for (const [edge, count] of edges) {
    assert.ok(count === 1 || count === 2, `non-manifold edge ${edge}`);
    if (count === 2) continue;
    boundaryEdges++;
    const [a, b] = edge.split(':').map((value) => Number(value) * 3);
    const isOuterEdge = [0, 2].some(
      (axis) =>
        Math.abs(positions[a + axis]) === 1100 &&
        positions[a + axis] === positions[b + axis],
    );
    assert.ok(isOuterEdge, `unpaired interior edge ${edge}`);
  }
  assert.equal(boundaryEdges, 4 * TERRAIN_QUALITY.low.segments);
  console.log(
    `verified ${indices.length / 3} triangle centroids; max error ${maxError} m`,
  );
});

test('the standard terrain reduces geometry without changing the rendered footprint', () => {
  const data = createLunarTerrainData('standard');
  assert.ok(data.indices.length / 3 < 180000);
  assert.equal(data.heightAt(1101, 0), data.heightAt(1100, 0));
  assert.equal(data.heightAt(-1101, 0), data.heightAt(-1100, 0));
});
