import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  DEFAULT_ROVER_MODEL,
  ROVER_MODELS,
  createRoverSwitcher,
  prepareRoverModel,
  getRoverGroundPose,
  updateRoverWheels,
  type RoverInstance,
  type RoverModelId,
} from './rover-models';
import {
  framingScale,
  hasOpenOverlay,
  shortcutBlocked,
  frameDelta,
} from './scene-controls';
import { createLunarTerrain } from './lunar-terrain';
import {
  makeRocks,
  disposeRocks,
  makeStars,
  makeSurfaceDetail,
} from './lunar-environment';
import {
  QUALITY_SETTINGS,
  resolveQuality,
  type QualityChoice,
  type QualityLevel,
} from './scene-settings';

export type ViewMode = 'follow' | 'free' | 'detail';
export type Telemetry = {
  distance: number;
  heading: number;
  elapsed: number;
  fps: number;
};
export type LunarWorld = {
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  setView: (value: ViewMode) => void;
  resetView: () => void;
  setModel: (id: RoverModelId) => Promise<boolean>;
  setQuality: (value: QualityChoice) => void;
  dispose: () => void;
};
type Callbacks = {
  onQualityChange: (level: QualityLevel) => void;
  onPhase: (phase: string) => void;
  onLoad: () => void;
  onProgress: (value: number) => void;
  onError: (message: string) => void;
  onTelemetry: (data: Telemetry) => void;
  onModelChange: (id: RoverModelId) => void;
  onModelLoading: (id: RoverModelId | null) => void;
  onModelError: (message: string) => void;
};

export function createLunarWorld(
  host: HTMLElement,
  callbacks: Callbacks,
): LunarWorld {
  let disposed = false,
    playing = true,
    speed = 1,
    mode: ViewMode = 'follow',
    loaded = false;
  let activeModel: RoverInstance | null = null;
  let modelConfig = ROVER_MODELS[
    DEFAULT_ROVER_MODEL
  ] as (typeof ROVER_MODELS)[RoverModelId];
  let distance = 0,
    elapsed = 0,
    frame = 0,
    frameCount = 0,
    frameTime = 0,
    telemetryTime = 0;
  let renderDirty = true,
    poseDirty = true,
    contextLost = false,
    ticking = false,
    telemetryDirty = true;
  let qualityChoice: QualityChoice = 'auto',
    autoLimited = false;
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let quality = resolveQuality(
    qualityChoice,
    host.clientWidth,
    coarsePointer.matches,
    navigator.hardwareConcurrency,
  );
  let settings = QUALITY_SETTINGS[quality];
  let shadowTime = 0,
    slowTime = 0;
  let previousTime = performance.now();
  const wake = () => {
    renderDirty = true;
    if (!disposed && !contextLost && !document.hidden && !frame && !ticking) {
      previousTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  const width = host.clientWidth,
    height = host.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.035, 4500);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, settings.pixelRatio),
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    'aria-label',
    '月面三维场景。拖动旋转，滚轮缩放，右键平移。方向键旋转，加减键缩放。自由探索模式下使用 WASD 移动和 QE 升降。',
  );
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 1.1;
  controls.maxDistance = 100;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.zoomSpeed = 0.75;
  controls.rotateSpeed = 0.55;
  controls.panSpeed = 0.65;
  controls.screenSpacePanning = false;
  controls.target.set(0, modelConfig.targetHeight, 0);
  const cameraScale = () =>
    framingScale(
      activeModel?.viewRadius ?? 1.7,
      camera.aspect,
      modelConfig.cameraScale,
      camera.fov,
    );
  const initialCamera = () =>
    new THREE.Vector3(4.7, 2.9, -5.7).multiplyScalar(cameraScale());
  camera.position.copy(initialCamera());
  controls.update();

  // The Moon has no sky scattering; restrained indirect light represents bounced regolith light.
  scene.add(new THREE.HemisphereLight(0xe3e5ee, 0x797469, 0.38));
  const sun = new THREE.DirectionalLight(0xfff5e5, 4.3);
  sun.position.set(-30, 26, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  sun.shadow.camera.left = -13;
  sun.shadow.camera.right = 13;
  sun.shadow.camera.top = 13;
  sun.shadow.camera.bottom = -13;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 100;
  sun.shadow.normalBias = 0.018;
  sun.shadow.bias = -0.00012;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  // A physically neutral, low energy reflection environment gives metals legible reflections.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x121317);
  const envGround = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 16),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x60605d }),
  );
  envGround.scale.set(1, 0.5, 1);
  envGround.position.y = -6;
  envScene.add(envGround);
  const reflector = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.7) }),
  );
  reflector.position.set(-5, 7, 4);
  reflector.lookAt(0, 0, 0);
  envScene.add(reflector);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(envScene, 0.03);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.48;
  envGround.geometry.dispose();
  (envGround.material as THREE.Material).dispose();
  reflector.geometry.dispose();
  (reflector.material as THREE.Material).dispose();
  pmrem.dispose();

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, done, total) => {
    if (!disposed) callbacks.onProgress(20 + (done / total) * 75);
  };
  const textureLoader = new THREE.TextureLoader(manager);
  const texture = (name: string, color = false) => {
    const map = textureLoader.load(`/assets/terrain/${name}`);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    return map;
  };
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: 0xb5b5b2,
    roughness: 1,
    metalness: 0,
    map: texture('moon_01_diff_2k.jpg', true),
    normalMap: texture('moon_01_nor_gl_2k.jpg'),
    roughnessMap: texture('moon_01_rough_2k.jpg'),
    aoMap: texture('moon_01_ao_2k.jpg'),
    aoMapIntensity: 0.85,
    normalScale: new THREE.Vector2(0.85, 0.85),
    vertexColors: true,
  });
  callbacks.onPhase('准备月面地形');
  let terrain = createLunarTerrain(groundMaterial, quality);
  const terrainHeight = (x: number, z: number) => terrain.heightAt(x, z);
  scene.add(terrain.mesh);
  let rocks = makeRocks(groundMaterial, terrainHeight, quality);
  scene.add(rocks);
  callbacks.onQualityChange(quality);
  makeStars(scene);
  callbacks.onProgress(15);
  callbacks.onPhase('加载模型与月壤材质');

  const rover = new THREE.Group();
  rover.name = 'Active lunar rover';
  scene.add(rover);
  const foilDetail = makeSurfaceDetail('foil');
  const solarCells = makeSurfaceDetail('cells');
  let terrainReady = false,
    terrainFailed = false;
  const finishLoading = () => {
    if (disposed || loaded || terrainFailed || !terrainReady || !activeModel)
      return;
    loaded = true;
    callbacks.onProgress(100);
    callbacks.onLoad();
    wake();
  };
  manager.onLoad = () => {
    terrainReady = true;
    finishLoading();
  };
  manager.onError = () => {
    terrainFailed = true;
    if (!disposed) callbacks.onError('月面材质未能加载，请刷新页面重试。');
  };
  const modelLoader = new GLTFLoader();
  const switcher = createRoverSwitcher<RoverInstance>({
    load: async (id) => {
      const gltf = await modelLoader.loadAsync(ROVER_MODELS[id].url);
      try {
        const instance = prepareRoverModel(id, gltf.scene);
        if (id === 'viper')
          gltf.scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const mat of materials) {
              if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
              const name = mat.name.toLowerCase();
              if (name.includes('gold')) {
                mat.color.setHex(0xb8994c);
                mat.metalness = 0.87;
                mat.roughness = 0.4;
                mat.bumpMap = foilDetail;
                mat.bumpScale = 0.009;
              } else if (name.includes('silver')) {
                mat.color.setHex(0xc8cbc7);
                mat.metalness = 0.88;
                mat.roughness = 0.34;
                mat.bumpMap = foilDetail;
                mat.bumpScale = 0.007;
              } else if (name.includes('black')) {
                mat.color.setHex(0x1c201f);
                mat.metalness = 0.35;
                mat.roughness = 0.6;
              } else if (name.includes('panel')) {
                mat.color.setHex(0xffffff);
                mat.map = solarCells;
                mat.metalness = 0.64;
                mat.roughness = 0.32;
              } else {
                mat.metalness = 0.55;
                mat.roughness = 0.43;
              }
              mat.envMapIntensity = 1;
            }
          });
        // The two concept rovers keep their exported Blender materials.
        return instance;
      } catch (error) {
        disposeObject(gltf.scene);
        throw error;
      }
    },
    activate: (instance, id) => {
      const previous = activeModel;
      if (previous === instance) {
        callbacks.onModelChange(id);
        return;
      }
      const oldConfig = modelConfig;
      const oldCameraScale = cameraScale();
      if (previous) rover.remove(previous.object);
      activeModel = instance;
      modelConfig = ROVER_MODELS[id];
      rover.add(instance.object);
      rover.position.y += modelConfig.groundOffset - oldConfig.groundOffset;
      if (previous && mode !== 'free') {
        // Preserve the viewing direction and zoom proportion, adapting the centre to the new body.
        const oldTarget = controls.target.clone();
        const newTarget = oldTarget.clone();
        newTarget.y +=
          modelConfig.targetHeight +
          modelConfig.groundOffset -
          oldConfig.targetHeight -
          oldConfig.groundOffset;
        const offset = camera.position
          .clone()
          .sub(oldTarget)
          .multiplyScalar(cameraScale() / oldCameraScale);
        camera.position.copy(newTarget).add(offset);
        controls.target.copy(newTarget);
        transition = null;
      }
      if (!previous) {
        camera.position.copy(rover.position).add(initialCamera());
        controls.target
          .copy(rover.position)
          .add(new THREE.Vector3(0, modelConfig.targetHeight, 0));
      }
      wake();
      poseDirty = true;
      renderer.shadowMap.needsUpdate = true;
      updateRoverWheels(instance, distance, 1, terrainHeight);
      callbacks.onModelChange(id);
      finishLoading();
    },
    dispose: (instance) => {
      rover.remove(instance.object);
      disposeObject(instance.object);
    },
    onLoading: (id) => {
      if (!disposed) callbacks.onModelLoading(id);
    },
    onError: (_error, id) => {
      if (disposed) return;
      if (activeModel)
        callbacks.onModelError(
          `${ROVER_MODELS[id].name} 未能加载，当前月球车继续保留。请重新选择以重试。`,
        );
      else
        callbacks.onError(
          '探测车模型未能加载，请确认本地资源完整，然后刷新重试。',
        );
    },
  });
  rover.position.set(0, terrainHeight(0, 0) + modelConfig.groundOffset, 0);

  const trackCapacity = 9000;
  const trackGeometry = new THREE.PlaneGeometry(0.17, 0.025);
  trackGeometry.rotateX(-Math.PI / 2);
  const trackMaterial = new THREE.MeshStandardMaterial({
    color: 0x32322f,
    roughness: 1,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const tracks = new THREE.InstancedMesh(
    trackGeometry,
    trackMaterial,
    trackCapacity,
  );
  tracks.count = 0;
  tracks.frustumCulled = false;
  tracks.receiveShadow = true;
  tracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(tracks);
  const treadDummy = new THREE.Object3D();
  let trackIndex = 0,
    trackTotal = 0,
    lastTrack = -1;
  const pathAt = (d: number) => {
    const angle = d / 18;
    return { x: 18 * (1 - Math.cos(angle)), z: -18 * Math.sin(angle), angle };
  };
  const addTrack = (d: number) => {
    const path = pathAt(d);
    for (const side of [-1, 1]) {
      const x = path.x + Math.cos(path.angle) * side * modelConfig.halfTrack;
      const z = path.z + Math.sin(path.angle) * side * modelConfig.halfTrack;
      treadDummy.position.set(x, terrainHeight(x, z) + 0.012, z);
      treadDummy.rotation.set(0, -path.angle, 0);
      treadDummy.scale.set(modelConfig.treadWidth / 0.17, 1, 1);
      treadDummy.updateMatrix();
      tracks.setMatrixAt(trackIndex % trackCapacity, treadDummy.matrix);
      trackIndex++;
      trackTotal++;
    }
    tracks.count = Math.min(trackTotal, trackCapacity);
    tracks.instanceMatrix.needsUpdate = true;
  };
  for (let d = -6; d < -0.6; d += 0.09) addTrack(d);

  const applyQuality = (level: QualityLevel) => {
    if (disposed || quality === level) return;
    const nextTerrain = createLunarTerrain(groundMaterial, level);
    scene.remove(terrain.mesh);
    terrain.mesh.geometry.dispose();
    terrain = nextTerrain;
    scene.add(terrain.mesh);
    scene.remove(rocks);
    disposeRocks(rocks);
    quality = level;
    settings = QUALITY_SETTINGS[level];
    rocks = makeRocks(groundMaterial, terrainHeight, quality);
    scene.add(rocks);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < tracks.count; i++) {
      tracks.getMatrixAt(i, matrix);
      matrix.elements[13] =
        terrainHeight(matrix.elements[12], matrix.elements[14]) + 0.012;
      tracks.setMatrixAt(i, matrix);
    }
    tracks.instanceMatrix.needsUpdate = true;
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, settings.pixelRatio),
    );
    sun.shadow.dispose();
    sun.shadow.map = null;
    sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
    renderer.shadowMap.needsUpdate = true;
    poseDirty = true;
    callbacks.onQualityChange(quality);
    wake();
  };

  const keys = new Set<string>();
  const onKeyDown = (event: KeyboardEvent) => {
    if (hasOpenOverlay()) {
      keys.clear();
      return;
    }
    if (shortcutBlocked(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        'input,textarea,select,[contenteditable="true"],[role="slider"],[role="combobox"],[role="listbox"],[role="option"]',
      )
    )
      return;
    const movementKey = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'ShiftLeft',
      'ShiftRight',
    ].includes(event.code);
    const cameraKey = [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Equal',
      'Minus',
      'NumpadAdd',
      'NumpadSubtract',
    ].includes(event.code);
    if (
      (mode === 'free' && movementKey) ||
      (target === renderer.domElement && cameraKey)
    ) {
      keys.add(event.code);
      transition = null;
      event.preventDefault();
      wake();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.code);
  };
  const clearKeys = () => keys.clear();
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeys);
  renderer.domElement.addEventListener('blur', clearKeys);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    keys.clear();
    callbacks.onError('三维画面已中断，请刷新页面恢复。');
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  const resize = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h || disposed) return;
    const oldScale = cameraScale();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (qualityChoice === 'auto')
      applyQuality(
        autoLimited
          ? 'low'
          : resolveQuality(
              'auto',
              w,
              coarsePointer.matches,
              navigator.hardwareConcurrency,
            ),
      );
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, settings.pixelRatio),
    );
    if (mode !== 'free') {
      const ratio = cameraScale() / oldScale;
      camera.position
        .sub(controls.target)
        .multiplyScalar(ratio)
        .add(controls.target);
      if (transition)
        transition.position
          .sub(transition.target)
          .multiplyScalar(ratio)
          .add(transition.target);
    }
    wake();
  });
  resize.observe(host);

  let transition: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    time: number;
  } | null = null;
  const resetView = () => {
    mode = 'follow';
    controls.maxDistance = 100;
    const offset = initialCamera();
    transition = {
      position: rover.position.clone().add(offset),
      target: rover.position
        .clone()
        .add(new THREE.Vector3(0, modelConfig.targetHeight, 0)),
      time: 0,
    };
  };
  const onControlStart = () => {
    transition = null;
    wake();
  };
  controls.addEventListener('start', onControlStart);
  controls.addEventListener('change', wake);
  const previousRover = new THREE.Vector3();
  const forward = new THREE.Vector3(),
    right = new THREE.Vector3(),
    movement = new THREE.Vector3();
  const normal = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    steering = new THREE.Quaternion();
  const yawAxis = new THREE.Vector3(0, 1, 0);
  const orbitOffset = new THREE.Vector3(),
    orbit = new THREE.Spherical();
  const tick = (now: number) => {
    if (disposed || contextLost) return;
    frame = 0;
    if (document.hidden) return;
    ticking = true;
    const { elapsed: wallDt, smoothing: dt } = frameDelta(previousTime, now);
    previousTime = now;
    if (loaded && (playing || poseDirty)) {
      shadowTime += wallDt;
      if (poseDirty || shadowTime >= 1 / settings.shadowHz) {
        renderer.shadowMap.needsUpdate = true;
        shadowTime = 0;
      }
      poseDirty = false;
      renderDirty = true;
      previousRover.copy(rover.position);
      if (playing) {
        distance += wallDt * 0.12 * speed;
        elapsed += wallDt;
      }
      const path = pathAt(distance);
      const pose = getRoverGroundPose(
        activeModel!.id,
        path.x,
        path.z,
        path.angle,
        terrainHeight,
      );
      rover.position.set(path.x, pose.elevation, path.z);
      normal.set(pose.normalX, 1, pose.normalZ).normalize();
      rotation.setFromUnitVectors(yawAxis, normal);
      steering.setFromAxisAngle(yawAxis, -path.angle);
      rover.quaternion.copy(rotation).multiply(steering);
      if (activeModel)
        updateRoverWheels(activeModel, distance, normal.y, terrainHeight);
      if (mode !== 'free') {
        movement.subVectors(rover.position, previousRover);
        camera.position.add(movement);
        controls.target.add(movement);
        if (transition) {
          transition.position.add(movement);
          transition.target.add(movement);
        }
      }
      if (playing && distance - lastTrack > 0.09) {
        addTrack(distance - modelConfig.halfWheelbase);
        lastTrack = distance;
      }
      sun.target.position.copy(rover.position);
      sun.position.copy(rover.position).add(new THREE.Vector3(-30, 26, 18));
    }
    if (transition) {
      renderDirty = true;
      transition.time += dt;
      const alpha = reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5);
      camera.position.lerp(transition.position, alpha);
      controls.target.lerp(transition.target, alpha);
      if (reducedMotion.matches || transition.time > 1.7) transition = null;
    }
    if (mode === 'free' && keys.size) {
      renderDirty = true;
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, camera.up).normalize();
      movement.set(0, 0, 0);
      if (keys.has('KeyW')) movement.add(forward);
      if (keys.has('KeyS')) movement.sub(forward);
      if (keys.has('KeyD')) movement.add(right);
      if (keys.has('KeyA')) movement.sub(right);
      if (keys.has('KeyE')) movement.y += 1;
      if (keys.has('KeyQ')) movement.y -= 1;
      movement
        .normalize()
        .multiplyScalar(
          wallDt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8 : 3),
        );
      camera.position.add(movement);
      controls.target.add(movement);
    }
    if (keys.size) {
      orbitOffset.copy(camera.position).sub(controls.target);
      orbit.setFromVector3(orbitOffset);
      const rotate = wallDt * 1.1;
      if (keys.has('ArrowLeft')) orbit.theta += rotate;
      if (keys.has('ArrowRight')) orbit.theta -= rotate;
      if (keys.has('ArrowUp')) orbit.phi -= rotate;
      if (keys.has('ArrowDown')) orbit.phi += rotate;
      if (keys.has('Equal') || keys.has('NumpadAdd'))
        orbit.radius *= Math.exp(-wallDt * 1.4);
      if (keys.has('Minus') || keys.has('NumpadSubtract'))
        orbit.radius *= Math.exp(wallDt * 1.4);
      orbit.phi = THREE.MathUtils.clamp(
        orbit.phi,
        0.05,
        controls.maxPolarAngle,
      );
      orbit.radius = THREE.MathUtils.clamp(
        orbit.radius,
        controls.minDistance,
        controls.maxDistance,
      );
      camera.position
        .copy(controls.target)
        .add(orbitOffset.setFromSpherical(orbit));
      renderDirty = true;
    }
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -350, 350);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -350, 350);
    controls.target.y = Math.max(
      controls.target.y,
      terrainHeight(controls.target.x, controls.target.z) + 0.15,
    );
    const cameraChanged = controls.update();
    const minimumY = terrainHeight(camera.position.x, camera.position.z) + 0.2;
    if (camera.position.y < minimumY) {
      camera.position.y = minimumY;
      renderDirty = true;
    }
    if (renderDirty || cameraChanged) {
      renderer.render(scene, camera);
      renderDirty = false;
      frameCount++;
    }
    frameTime += wallDt;
    telemetryTime += wallDt;
    if (loaded && ((telemetryTime >= 0.5 && playing) || telemetryDirty)) {
      callbacks.onTelemetry({
        distance,
        elapsed,
        heading: ((distance / 18) * 180) / Math.PI,
        fps: Math.round(frameCount / frameTime),
      });
      if (
        qualityChoice === 'auto' &&
        quality !== 'low' &&
        playing &&
        elapsed > 3
      ) {
        slowTime =
          frameCount / Math.max(0.001, frameTime) < 28
            ? slowTime + telemetryTime
            : 0;
        if (slowTime >= 3) {
          autoLimited = true;
          applyQuality('low');
          slowTime = 0;
        }
      }
      telemetryTime = 0;
      frameCount = 0;
      frameTime = 0;
      telemetryDirty = false;
    }
    ticking = false;
    if (
      renderDirty ||
      (loaded && playing) ||
      transition ||
      keys.size ||
      cameraChanged
    )
      frame = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    keys.clear();
    previousTime = performance.now();
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else wake();
  };
  document.addEventListener('visibilitychange', onVisibility);
  frame = requestAnimationFrame(tick);
  void switcher.select(DEFAULT_ROVER_MODEL);
  return {
    setPlaying: (value) => {
      playing = value;
      renderer.shadowMap.needsUpdate = true;
      telemetryDirty = true;
      wake();
    },
    setSpeed: (value) => {
      speed = THREE.MathUtils.clamp(value, 0.5, 4);
    },
    setView: (value) => {
      mode = value;
      keys.clear();
      transition = null;
      wake();
      if (value === 'free') renderer.domElement.focus({ preventScroll: true });
      controls.maxDistance = value === 'free' ? 170 : 100;
      if (value === 'detail')
        transition = {
          position: rover.position
            .clone()
            .add(
              new THREE.Vector3(2.4, 1.55, -2.9).multiplyScalar(cameraScale()),
            ),
          target: rover.position
            .clone()
            .add(new THREE.Vector3(0, modelConfig.targetHeight, 0)),
          time: 0,
        };
      if (value === 'follow') resetView();
    },
    resetView: () => {
      resetView();
      wake();
    },
    setQuality: (value) => {
      qualityChoice = value;
      autoLimited = false;
      slowTime = 0;
      applyQuality(
        resolveQuality(
          value,
          host.clientWidth,
          coarsePointer.matches,
          navigator.hardwareConcurrency,
        ),
      );
    },
    setModel: (id) => switcher.select(id),
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener('start', onControlStart);
      controls.removeEventListener('change', wake);
      controls.dispose();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearKeys);
      renderer.domElement.removeEventListener('blur', clearKeys);
      renderer.domElement.removeEventListener(
        'webglcontextlost',
        onContextLost,
      );
      switcher.dispose();
      disposeObject(scene);
      foilDetail.dispose();
      solarCells.dispose();
      environment.dispose();
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  object.traverse((item) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Points) {
      if (item instanceof THREE.InstancedMesh) item.dispose();
      geometries.add(item.geometry);
      const list = Array.isArray(item.material)
        ? item.material
        : [item.material];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}
