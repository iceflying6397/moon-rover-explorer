import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ROVER_OPTIONS } from '../lib/rover-catalog.ts';

// Validate distributable files here; test:rover already checks the actual GLB
// geometry, wheel hierarchy, ground contact, animation and model switching.
for (const config of ROVER_OPTIONS) {
  const binary = await readFile(
    new URL(`../public${config.url}`, import.meta.url),
  );
  const fail = (message) => `${config.name}: ${message}`;
  assert(binary.length >= 20, fail('GLB header is incomplete'));
  assert.equal(
    binary.readUInt32LE(0),
    0x46546c67,
    fail('GLB magic is invalid'),
  );
  assert.equal(binary.readUInt32LE(4), 2, fail('GLB version must be 2'));
  assert.equal(
    binary.readUInt32LE(8),
    binary.length,
    fail('GLB length does not match the file'),
  );

  const chunks = [];
  for (let offset = 12; offset < binary.length;) {
    assert(offset + 8 <= binary.length, fail('GLB chunk header is incomplete'));
    const length = binary.readUInt32LE(offset);
    const type = binary.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0, fail('GLB chunks must be four-byte aligned'));
    assert(
      offset + 8 + length <= binary.length,
      fail('GLB chunk exceeds the file'),
    );
    chunks.push({
      type,
      data: binary.subarray(offset + 8, offset + 8 + length),
    });
    offset += 8 + length;
  }

  assert.equal(
    chunks[0]?.type,
    0x4e4f534a,
    fail('The first GLB chunk must contain JSON'),
  );
  const document = JSON.parse(chunks[0].data.toString('utf8'));
  const bin = chunks.find((chunk) => chunk.type === 0x004e4942)?.data;
  assert.equal(
    document.asset?.version,
    '2.0',
    fail('glTF asset version must be 2.0'),
  );
  assert(bin, fail('An embedded binary buffer is required'));
  assert.equal(
    document.buffers?.length,
    1,
    fail('One embedded buffer is required'),
  );
  assert.equal(
    document.buffers[0].uri,
    undefined,
    fail('External buffers are not allowed'),
  );
  const byteLength = document.buffers[0].byteLength;
  assert(
    Number.isInteger(byteLength) && byteLength > 0,
    fail('The buffer length is invalid'),
  );
  assert(
    bin.length >= byteLength && bin.length - byteLength <= 3,
    fail('Embedded buffer length is invalid'),
  );

  for (const [index, view] of (document.bufferViews ?? []).entries()) {
    const offset = view.byteOffset ?? 0;
    assert.equal(
      view.buffer,
      0,
      fail(`Buffer view ${index} references a missing buffer`),
    );
    assert(
      Number.isInteger(offset) && offset >= 0,
      fail(`Buffer view ${index} has an invalid offset`),
    );
    assert(
      Number.isInteger(view.byteLength) && view.byteLength > 0,
      fail(`Buffer view ${index} has an invalid length`),
    );
    assert(
      offset + view.byteLength <= byteLength,
      fail(`Buffer view ${index} exceeds the buffer`),
    );
  }
  for (const [index, image] of (document.images ?? []).entries()) {
    if (image.uri !== undefined) {
      assert(
        typeof image.uri === 'string' && image.uri.startsWith('data:'),
        fail(`Image ${index} must be embedded`),
      );
    } else {
      assert(
        Number.isInteger(image.bufferView) &&
          document.bufferViews?.[image.bufferView],
        fail(`Image ${index} references a missing buffer view`),
      );
    }
  }
  assert(
    document.meshes?.length > 0 && document.nodes?.length > 0,
    fail('The GLB must contain a model'),
  );
  console.log(
    `PASS: ${config.name} — ${(binary.length / 1024 / 1024).toFixed(2)} MiB, valid self-contained GLB.`,
  );
}

for (const name of ['diff', 'nor_gl', 'rough', 'ao']) {
  const data = await readFile(
    new URL(`../public/assets/terrain/moon_01_${name}_2k.jpg`, import.meta.url),
  );
  assert(
    data.length > 4 &&
      data.readUInt16BE(0) === 0xffd8 &&
      data.readUInt16BE(data.length - 2) === 0xffd9,
    `${name}: a complete local JPEG is required`,
  );
}
console.log(
  'PASS: all four local terrain PBR maps are present and have complete JPEG boundaries.',
);
