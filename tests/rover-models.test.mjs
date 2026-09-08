import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  ROVER_MODELS,
  prepareRoverModel,
  getRoverGroundPose,
  updateRoverWheels,
  createRoverSwitcher,
} from '../lib/rover-models.ts';
import { framingScale, pageShortcut } from '../lib/scene-controls.ts';

// Use the actual exported geometry and hierarchy. Image decoding is browser-only;
// remove texture bindings here while preserving the original GLB binary data.
async function readModel(id) {
  const file = await readFile(
    new URL(`../public${ROVER_MODELS[id].url}`, import.meta.url),
  );
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  function stripTextures(object) {
    if (!object || typeof object !== 'object') return;
    for (const key of Object.keys(object)) {
      if (key.endsWith('Texture')) delete object[key];
      else stripTextures(object[key]);
    }
  }
  stripTextures(json.materials);
  json.images = [];
  json.textures = [];
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const bin = file.subarray(20 + jsonLength);
  const result = Buffer.alloc(20 + padded.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  bin.copy(result, 20 + padded.length);
  return new GLTFLoader().parseAsync(
    result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ),
    '',
  );
}
function close(actual, expected, tolerance = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} differs from ${expected}`,
  );
}

for (const id of Object.keys(ROVER_MODELS)) {
  test(`${id}: real GLB is forward-facing, grounded and has the expected independent wheel pivots`, async () => {
    const { scene } = await readModel(id);
    const instance = prepareRoverModel(id, scene);
    const config = ROVER_MODELS[id];
    const rover = new THREE.Group();
    rover.position.y = config.groundOffset;
    rover.add(scene);
    rover.updateMatrixWorld(true);
    const front = (
      id === 'white-mecha'
        ? new THREE.Vector3(0, 0, 1)
        : new THREE.Vector3(id === 'viper' ? 1 : -1, 0, 0)
    ).applyQuaternion(scene.quaternion);
    close(front.x, 0);
    close(front.y, 0);
    close(front.z, -1);
    assert.equal(instance.wheels.length, id === 'white-mecha' ? 6 : 4);
    const axle = instance.spinAxis.clone().applyQuaternion(scene.quaternion);
    close(axle.x, -1);
    close(axle.y, 0);
    close(axle.z, 0);
    for (const wheel of instance.wheels) {
      const p = wheel.object.getWorldPosition(new THREE.Vector3());
      close(Math.abs(p.x), config.halfTrack);
      if (id === 'white-mecha')
        close(
          p.z,
          wheel.object.name.endsWith('front')
            ? -0.89
            : wheel.object.name.endsWith('middle')
              ? 0.025
              : 0.88,
        );
      else close(Math.abs(p.z), config.halfWheelbase);
    }
    updateRoverWheels(instance, 0, 1, () => 0);
    rover.updateMatrixWorld(true);
    for (const wheel of instance.wheels) {
      close(
        wheel.object.getWorldPosition(new THREE.Vector3()).y,
        config.contactRadius,
      );
      const rollingAxis = instance.spinAxis
        .clone()
        .applyQuaternion(
          wheel.object.getWorldQuaternion(new THREE.Quaternion()),
        );
      close(rollingAxis.x, -1);
      close(rollingAxis.y, 0);
      close(rollingAxis.z, 0);
    }
    const bounds = new THREE.Box3().setFromObject(scene);
    assert.ok(Math.abs(bounds.min.y) < 0.02, `ground contact ${bounds.min.y}`);
    for (const [width, height] of [
      [375, 812],
      [320, 568],
      [844, 390],
      [1280, 800],
    ]) {
      const scale = framingScale(
        instance.viewRadius,
        width / height,
        config.cameraScale,
      );
      const distance = Math.hypot(4.7, 2.9, 5.7) * scale;
      const angle = Math.min(
        Math.PI / 9,
        Math.atan((Math.tan(Math.PI / 9) * width) / height),
      );
      assert.ok(
        distance * Math.sin(angle) >= instance.viewRadius * 1.079,
        'entire vehicle must fit the viewport',
      );
    }
    const originals = instance.wheels.map((w) => w.object.quaternion.clone());
    updateRoverWheels(instance, (config.radius * Math.PI) / 2, 1, () => 0);
    instance.wheels.forEach((w, index) =>
      close(w.object.quaternion.angleTo(originals[index]), Math.PI / 2),
    );
    // Reapplying the same distance while paused must not continue spinning or drift.
    const paused = instance.wheels.map((w) => ({
      position: w.object.position.clone(),
      rotation: w.object.quaternion.clone(),
    }));
    for (let i = 0; i < 20; i++)
      updateRoverWheels(instance, (config.radius * Math.PI) / 2, 1, () => 0);
    instance.wheels.forEach((w, index) => {
      close(w.object.position.distanceTo(paused[index].position), 0);
      close(w.object.quaternion.angleTo(paused[index].rotation), 0);
    });
  });
}
test('six-wheel body follows a sloped plane at any heading and includes middle contacts', () => {
  const terrain = (x, z) => 0.25 + 0.013 * x - 0.008 * z;
  for (const angle of [0, 0.4, Math.PI / 2, Math.PI]) {
    const pose = getRoverGroundPose('white-mecha', 5, -3, angle, terrain);
    close(pose.elevation, terrain(5, -3));
    close(pose.normalX, -0.013);
    close(pose.normalZ, 0.008);
  }
  const middleBump = getRoverGroundPose('white-mecha', 0, 0, 0, (_x, z) =>
    Math.abs(z - 0.025) < 0.001 ? 0.015 : 0,
  );
  assert.ok(middleBump.elevation > 0.004 && middleBump.elevation < 0.006);
});
test('shortcuts work after button focus but leave inputs, menus and repeated keydown alone', () => {
  const normal = {
    repeat: false,
    editing: false,
    modalOpen: false,
    buttonFocused: false,
  };
  assert.equal(pageShortcut('Space', normal), 'play');
  assert.equal(
    pageShortcut('KeyH', { ...normal, buttonFocused: true }),
    'interface',
  );
  assert.equal(
    pageShortcut('KeyR', { ...normal, buttonFocused: true }),
    'reset',
  );
  assert.equal(pageShortcut('Space', { ...normal, buttonFocused: true }), null);
  for (const code of ['Space', 'KeyH', 'KeyR']) {
    for (const flag of ['repeat', 'editing', 'modalOpen'])
      assert.equal(pageShortcut(code, { ...normal, [flag]: true }), null);
  }
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = () => Promise.resolve();
function harness(load) {
  const active = [],
    errors = [],
    disposed = [],
    loading = [];
  const switcher = createRoverSwitcher({
    load,
    activate: (_model, id) => active.push(id),
    dispose: (model) => disposed.push(model),
    onLoading: (id) => loading.push(id),
    onError: (error, id) => errors.push(id),
  });
  return { switcher, active, errors, disposed, loading };
}
test('latest selection wins while older load completes; models are cached', async () => {
  const waits = {
    selene: deferred(),
    viper: deferred(),
    'white-mecha': deferred(),
  };
  let loads = 0;
  const h = harness((id) => {
    loads++;
    return waits[id].promise;
  });
  const first = h.switcher.select('selene');
  const middle = h.switcher.select('viper');
  const last = h.switcher.select('white-mecha');
  await flush();
  waits['white-mecha'].resolve({ id: 'white-mecha' });
  assert.equal(await last, true);
  waits.viper.resolve({ id: 'viper' });
  assert.equal(await middle, false);
  waits.selene.resolve({ id: 'selene' });
  assert.equal(await first, false);
  assert.deepEqual(h.active, ['white-mecha']);
  for (const id of ['selene', 'viper', 'white-mecha'])
    assert.equal(await h.switcher.select(id), true);
  assert.equal(loads, 3);
  h.switcher.dispose();
  h.switcher.dispose();
  assert.equal(h.disposed.length, 3);
});
test('failed switch retains the active model and can be retried', async () => {
  let fail = true;
  const h = harness(async (id) => {
    if (id === 'viper' && fail) throw Error('network');
    return { id };
  });
  assert.equal(await h.switcher.select('selene'), true);
  assert.equal(await h.switcher.select('viper'), false);
  assert.deepEqual(h.active, ['selene']);
  assert.deepEqual(h.errors, ['viper']);
  assert.equal(h.loading.at(-1), null);
  fail = false;
  assert.equal(await h.switcher.select('viper'), true);
  assert.deepEqual(h.active, ['selene', 'viper']);
  h.switcher.dispose();
});
test('disposal releases late loads without applying them or invoking callbacks', async () => {
  const wait = deferred();
  const h = harness(() => wait.promise);
  const task = h.switcher.select('selene');
  await flush();
  h.switcher.dispose();
  wait.resolve({ id: 'selene' });
  assert.equal(await task, false);
  assert.deepEqual(h.active, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.disposed.length, 1);
  assert.deepEqual(h.loading, ['selene']);
});
test('repeated pending requests share one asset load', async () => {
  const wait = deferred();
  let loads = 0;
  const h = harness(() => {
    loads++;
    return wait.promise;
  });
  const first = h.switcher.select('selene');
  const last = h.switcher.select('selene');
  await flush();
  wait.resolve({ id: 'selene' });
  assert.equal(await first, false);
  assert.equal(await last, true);
  assert.equal(loads, 1);
  assert.deepEqual(h.active, ['selene']);
  h.switcher.dispose();
});
