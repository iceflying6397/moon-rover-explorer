import * as THREE from 'three';
import {
  ROVER_MODELS,
  isRoverModelId,
  type RoverModelId,
} from './rover-catalog.ts';
export {
  DEFAULT_ROVER_MODEL,
  ROVER_MODELS,
  ROVER_OPTIONS,
  isRoverModelId,
  type RoverModelId,
} from './rover-catalog.ts';

export type RoverWheel = {
  object: THREE.Object3D;
  restPosition: THREE.Vector3;
  restRotation: THREE.Quaternion;
};
export type RoverInstance = {
  id: RoverModelId;
  object: THREE.Group;
  wheels: RoverWheel[];
  suspension: Map<string, THREE.Object3D>;
  spinAxis: THREE.Vector3;
  viewRadius: number;
};

/** Convert each asset to the world's Y-up, -Z-forward convention exactly once. */
export function prepareRoverModel(
  id: RoverModelId,
  object: THREE.Group,
): RoverInstance {
  const config = ROVER_MODELS[id];
  if (id === 'viper') object.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  else if (id === 'white-mecha') object.rotation.set(0, Math.PI, 0);
  else object.rotation.set(0, -Math.PI / 2, 0);
  object.scale.setScalar(config.scale);
  const wheels: RoverWheel[] = [];
  const suspension = new Map<string, THREE.Object3D>();
  const wheelPattern =
    id === 'viper'
      ? /^wheel_(LF|RF|LB|RB)$/
      : id === 'white-mecha'
        ? /^Wheel_(L|R)_(front|middle|rear)$/
        : /^Wheel_(FL|FR|RL|RR)$/;
  object.traverse((part) => {
    const wheel = wheelPattern.test(part.name);
    if (wheel)
      wheels.push({
        object: part,
        restPosition: part.position.clone(),
        restRotation: part.quaternion.clone(),
      });
    if (
      id === 'viper' &&
      /^(bt_sus|up_sus|steer)_(LF|RF|LB|RB)$/.test(part.name)
    )
      suspension.set(part.name, part);
    if (part instanceof THREE.Mesh) {
      part.castShadow = true;
      part.receiveShadow = true;
    }
  });
  if (wheels.length !== config.wheelCount)
    throw new Error(`${config.name} 模型缺少独立车轮。`);
  object.updateMatrixWorld(true);
  const viewRadius = new THREE.Box3()
    .setFromObject(object)
    .getBoundingSphere(new THREE.Sphere()).radius;
  return {
    id,
    object,
    wheels,
    suspension,
    viewRadius,
    spinAxis: new THREE.Vector3(
      id === 'white-mecha' ? 1 : 0,
      id === 'viper' ? 1 : 0,
      id === 'selene' ? 1 : 0,
    ),
  };
}

/** Fit the body to its wheel contact patches, including the mecha's middle axle. */
export function getRoverGroundPose(
  id: RoverModelId,
  x: number,
  z: number,
  angle: number,
  terrainHeight: (x: number, z: number) => number,
) {
  const config = ROVER_MODELS[id],
    c = Math.cos(angle),
    s = Math.sin(angle);
  if (id === 'white-mecha') {
    const stations = ROVER_MODELS['white-mecha'].wheelOffsets;
    const meanStation =
      stations.reduce((sum, f) => sum + f, 0) / stations.length;
    let totalHeight = 0,
      lateralSum = 0,
      longitudinalSum = 0,
      longitudinalVariance = 0;
    for (const f of stations) {
      for (const side of [-1, 1]) {
        const lateral = side * config.halfTrack;
        const height = terrainHeight(
          x + c * lateral + s * f,
          z + s * lateral - c * f,
        );
        totalHeight += height;
        lateralSum += lateral * height;
        longitudinalSum += (f - meanStation) * height;
        longitudinalVariance += (f - meanStation) ** 2;
      }
    }
    const sideways = lateralSum / (config.wheelCount * config.halfTrack ** 2);
    const lengthwise = longitudinalSum / longitudinalVariance;
    return {
      elevation:
        totalHeight / config.wheelCount -
        meanStation * lengthwise +
        config.groundOffset,
      normalX: -c * sideways - s * lengthwise,
      normalZ: -s * sideways + c * lengthwise,
    };
  }
  const dx = c * config.halfTrack,
    dz = s * config.halfTrack;
  const fx = s * config.halfWheelbase,
    fz = -c * config.halfWheelbase;
  const lf = terrainHeight(x - dx + fx, z - dz + fz),
    rf = terrainHeight(x + dx + fx, z + dz + fz);
  const lr = terrainHeight(x - dx - fx, z - dz - fz),
    rr = terrainHeight(x + dx - fx, z + dz - fz);
  const sideways = (rf + rr - lf - lr) / (4 * config.halfTrack);
  const lengthwise = (lf + rf - lr - rr) / (4 * config.halfWheelbase);
  return {
    elevation: (lf + rf + lr + rr) / 4 + config.groundOffset,
    normalX: -c * sideways - s * lengthwise,
    normalZ: -s * sideways + c * lengthwise,
  };
}

const wheelCenter = new THREE.Vector3();
const roll = new THREE.Quaternion();
/** Place each wheel against the terrain and roll by actual travelled distance. */
export function updateRoverWheels(
  instance: RoverInstance,
  distance: number,
  normalY: number,
  terrainHeight: (x: number, z: number) => number,
) {
  const config = ROVER_MODELS[instance.id];
  for (const wheel of instance.wheels)
    wheel.object.position.copy(wheel.restPosition);
  instance.object.updateWorldMatrix(true, true);
  for (const wheel of instance.wheels) {
    const object = wheel.object;
    object.getWorldPosition(wheelCenter);
    const lift =
      (terrainHeight(wheelCenter.x, wheelCenter.z) +
        config.contactRadius -
        wheelCenter.y) /
      Math.max(0.5, normalY);
    // The concept models have static arms, so keep their visual travel small.
    const maxTravel =
      instance.id === 'viper'
        ? 0.11
        : instance.id === 'white-mecha'
          ? 0.025
          : 0.04;
    const travel = THREE.MathUtils.clamp(lift, -maxTravel, maxTravel);
    if (instance.id === 'viper') {
      object.position.z += travel;
      const suffix = object.name.slice(6),
        side = suffix.startsWith('L') ? 1 : -1;
      for (const name of ['bt_sus', 'up_sus']) {
        const arm = instance.suspension.get(`${name}_${suffix}`);
        if (arm) arm.rotation.x = side * Math.atan2(travel, 0.4031);
      }
      const upright = instance.suspension.get(`steer_${suffix}`);
      if (upright) upright.position.z = travel;
    } else object.position.y += travel / config.scale;
    roll.setFromAxisAngle(instance.spinAxis, distance / config.radius);
    object.quaternion.copy(wheel.restRotation).multiply(roll);
  }
}

/** Keep the old model visible until the latest request is ready. Cache local assets. */
export function createRoverSwitcher<T>(options: {
  load: (id: RoverModelId) => Promise<T>;
  activate: (model: T, id: RoverModelId) => void;
  dispose: (model: T) => void;
  onLoading: (id: RoverModelId | null) => void;
  onError: (error: unknown, id: RoverModelId) => void;
}) {
  let disposed = false,
    generation = 0;
  const cache = new Map<RoverModelId, T>();
  const pending = new Map<RoverModelId, Promise<T>>();
  return {
    async select(id: RoverModelId) {
      if (disposed || !isRoverModelId(id)) return false;
      const request = ++generation;
      options.onLoading(id);
      try {
        let model = cache.get(id);
        if (!model) {
          let promise = pending.get(id);
          if (!promise) {
            promise = Promise.resolve()
              .then(() => options.load(id))
              .then((loaded) => {
                if (disposed) options.dispose(loaded);
                else cache.set(id, loaded);
                return loaded;
              })
              .finally(() => pending.delete(id));
            pending.set(id, promise);
          }
          model = await promise;
        }
        if (disposed || request !== generation) return false;
        options.activate(model, id);
        options.onLoading(null);
        return true;
      } catch (error) {
        if (!disposed && request === generation) {
          options.onLoading(null);
          options.onError(error, id);
        }
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      for (const model of cache.values()) options.dispose(model);
      cache.clear();
    },
  };
}
