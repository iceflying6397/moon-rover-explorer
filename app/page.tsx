'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  LoaderCircle,
  Crosshair,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Orbit,
  Scan,
  Info,
  Mouse,
  Move,
  Eye,
  ChevronRight,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_ROVER_MODEL,
  ROVER_MODELS,
  ROVER_OPTIONS,
  isRoverModelId,
  type RoverModelId,
} from '@/lib/rover-catalog';
import type { LunarWorld, Telemetry, ViewMode } from '@/lib/lunar-world';
import { hasOpenOverlay, pageShortcut } from '@/lib/scene-controls';
import {
  QUALITY_LABELS,
  isQualityChoice,
  type QualityChoice,
  type QualityLevel,
} from '@/lib/scene-settings';

export default function Home() {
  const host = useRef<HTMLDivElement>(null);
  const helpTitle = useRef<HTMLHeadingElement>(null);
  const world = useRef<LunarWorld | null>(null);
  const controlState = useRef({
    playing: true,
    speed: 1,
    view: 'follow' as ViewMode,
  });
  const [model, setModel] = useState<RoverModelId>(DEFAULT_ROVER_MODEL);
  const [pendingModel, setPendingModel] = useState<RoverModelId | null>(null);
  const [modelError, setModelError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('准备三维场景');
  const [quality, setQuality] = useState<QualityChoice>('auto');
  const [actualQuality, setActualQuality] = useState<QualityLevel>('standard');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(true);
  const [view, setView] = useState<ViewMode>('follow');
  const [speed, setSpeed] = useState(1);
  const [hidden, setHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    distance: 0,
    heading: 0,
    elapsed: 0,
    fps: 0,
  });

  useEffect(() => {
    let cancelled = false;
    import('@/lib/lunar-world')
      .then(({ createLunarWorld }) => {
        if (cancelled || !host.current) return;
        try {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            controlState.current.playing = false;
            setPlaying(false);
          }
          world.current = createLunarWorld(host.current, {
            onQualityChange: (level) => {
              if (!cancelled) setActualQuality(level);
            },
            onPhase: (message) => {
              if (!cancelled) setPhase(message);
            },
            onLoad: () => {
              if (!cancelled) setLoaded(true);
            },
            onProgress: (p) => {
              if (!cancelled) setProgress(p);
            },
            onError: (message) => {
              if (!cancelled) setError(message);
            },
            onTelemetry: (data) => {
              if (!cancelled) setTelemetry(data);
            },
            onModelChange: (id) => {
              if (!cancelled) {
                setModel(id);
                setModelError('');
              }
            },
            onModelLoading: (id) => {
              if (!cancelled) {
                setPendingModel(id);
                if (id) setModelError('');
              }
            },
            onModelError: (message) => {
              if (!cancelled) setModelError(message);
            },
          });
          world.current.setPlaying(controlState.current.playing);
          world.current.setSpeed(controlState.current.speed);
          world.current.setView(controlState.current.view);
        } catch {
          setError(
            '无法启动三维画面，请使用支持 WebGL 2 的浏览器并开启图形加速。',
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError('场景加载失败，请刷新页面重试。');
      });
    return () => {
      cancelled = true;
      world.current?.dispose();
      world.current = null;
    };
  }, []);

  useEffect(() => {
    controlState.current.playing = playing;
    world.current?.setPlaying(playing);
  }, [playing, loaded]);
  useEffect(() => {
    controlState.current.speed = speed;
    world.current?.setSpeed(speed);
  }, [speed, loaded]);
  useEffect(() => {
    controlState.current.view = view;
    world.current?.setView(view);
  }, [view, loaded]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = pageShortcut(event.code, {
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        defaultPrevented: event.defaultPrevented,
        isComposing: event.isComposing,
        editing: Boolean(
          target?.closest(
            'input, textarea, select, [contenteditable="true"], [role="slider"], [role="combobox"], [role="listbox"], [role="option"]',
          ),
        ),
        modalOpen: hasOpenOverlay(),
        buttonFocused: Boolean(target?.closest('button, a')),
      });
      if (!action) return;
      event.preventDefault();
      if (action === 'play') setPlaying((p) => !p);
      if (action === 'interface') setHidden((h) => !h);
      if (action === 'reset') {
        setView('follow');
        world.current?.resetView();
      }
    };
    const onFullscreen = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const selectModel = (value: unknown) => {
    if (isRoverModelId(value) && (value !== model || pendingModel !== null))
      void world.current?.setModel(value);
  };
  const selectedRover = ROVER_MODELS[model];
  const selectQuality = (value: unknown) => {
    if (!isQualityChoice(value)) return;
    setQuality(value);
    world.current?.setQuality(value);
  };
  const displayHeading = ((Math.round(telemetry.heading) % 360) + 360) % 360;

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* Browser may not support full screen; the scene remains usable. */
    }
  };
  const seconds = Math.floor(telemetry.elapsed);
  const clock = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <main className={`explorer ${hidden ? 'is-immersive' : ''}`}>
      <div
        ref={host}
        className="world"
        aria-label="可交互的三维月面探测车场景"
      />
      <div className="cinematic-shade" />
      <div className="interface" inert={hidden} aria-hidden={hidden}>
        <header className="topbar">
          <Link className="wordmark" href="/" aria-label="SELENE 月面漫游首页">
            <span className="brand-orbit" />
            <span>
              SELENE<span className="wordmark-dot">.</span>
            </span>
          </Link>
          <div className="topbar-center">
            <span className="live-dot" /> LUNAR EXPLORATION{' '}
            <span className="separator">/</span>
            <span className="edition">交互式月面探索</span>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => setHidden(true)}
              aria-label="沉浸模式"
              title="沉浸模式 · H"
            >
              <Eye size={18} />
            </button>
            <Dialog>
              <DialogTrigger
                className="icon-button"
                aria-label="操作指南与模型来源"
              >
                <Info size={16} />
              </DialogTrigger>
              <DialogContent className="help-dialog" initialFocus={helpTitle}>
                <DialogTitle
                  ref={helpTitle}
                  tabIndex={-1}
                  className="outline-none"
                >
                  在月面，自由漫游。
                </DialogTitle>
                <DialogDescription>
                  使用鼠标、触屏或键盘，从不同角度查看月球车与月面。
                </DialogDescription>
                <div className="help-rows">
                  <p>
                    <span>旋转 / 缩放</span>
                    <b>鼠标左键拖动 / 滚轮</b>
                  </p>
                  <p>
                    <span>平移视角</span>
                    <b>鼠标右键拖动</b>
                  </p>
                  <p>
                    <span>自由探索</span>
                    <b>W A S D 移动 · Q E 升降 · Shift 加速</b>
                  </p>
                  <p>
                    <span>键盘查看</span>
                    <b>聚焦画面，方向键旋转 · ＋ / － 缩放</b>
                  </p>
                  <p>
                    <span>画质选择</span>
                    <b>自动 / 流畅 / 标准 / 精细</b>
                  </p>
                  <p>
                    <span>暂停 / 重置 / 隐藏界面</span>
                    <b>空格 / R / H</b>
                  </p>
                  <p>
                    <span>触屏操作</span>
                    <b>单指旋转 · 双指缩放和平移</b>
                  </p>
                </div>
                <div className="source-note">
                  SELENE 与白色机甲根据选定的设计图制作；VIPER 来自 Project
                  Chrono
                  的研究用工程模型。可通过「月球车模型」切换。月面地形为程序生成的探索场景，行驶数据为本地模拟。月壤材质来自
                  Poly Haven。
                  <a href="/CREDITS.md" target="_blank" rel="noreferrer">
                    查看资源来源 <ChevronRight size={14} />
                  </a>
                </div>
              </DialogContent>
            </Dialog>
            <button
              className="icon-button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? '退出全屏' : '进入全屏'}
              title={fullscreen ? '退出全屏' : '进入全屏'}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </header>

        <section className="mission-heading">
          <div className="eyebrow">
            <span>001</span>
            <i /> THE LUNAR FRONTIER
          </div>
          <h1>
            月面漫游<span className="title-star">✳</span>
          </h1>
          <p>越过寂静，探索未知。</p>
          <div className="rover-picker" aria-busy={pendingModel !== null}>
            <label
              className="rover-picker-label"
              id="rover-picker-label"
              htmlFor="rover-model"
            >
              月球车模型
            </label>
            <Select
              value={pendingModel ?? model}
              onValueChange={selectModel}
              disabled={!loaded}
            >
              <SelectTrigger
                id="rover-model"
                className="rover-select"
                aria-labelledby="rover-picker-label"
              >
                <span className="tag-line" />
                <SelectValue>
                  {ROVER_MODELS[pendingModel ?? model].label}
                </SelectValue>
                {pendingModel && (
                  <LoaderCircle className="model-spinner" aria-hidden="true" />
                )}
              </SelectTrigger>
              <SelectContent
                className="rover-select-menu"
                align="start"
                alignItemWithTrigger={false}
              >
                {ROVER_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <output className="rover-switch-status" aria-live="polite">
              {loaded && pendingModel
                ? `正在加载 ${ROVER_MODELS[pendingModel].name}…`
                : loaded
                  ? `当前：${selectedRover.label}`
                  : ''}
            </output>
            {modelError && (
              <p className="rover-switch-error" role="alert">
                {modelError}
              </p>
            )}
          </div>
        </section>

        <aside className="mission-readout" aria-label="探索状态">
          <div className="readout-heading">
            <span className={`live-dot ${!playing ? 'paused' : ''}`} />{' '}
            {playing ? '正在探索' : '已暂停'}
            <span className="tiny-cross">+</span>
          </div>
          <div className="readout-row">
            <span>探索时间</span>
            <b>{clock}</b>
          </div>
          <div className="readout-row">
            <span>行驶距离</span>
            <b>
              {telemetry.distance.toFixed(1)} <small>m</small>
            </b>
          </div>
          <div className="readout-row">
            <span>行驶速度</span>
            <b>
              {playing ? (0.12 * speed).toFixed(2) : '0.00'} <small>m/s</small>
            </b>
          </div>
          <div className="readout-footer">SIMULATED LUNAR ENVIRONMENT</div>
        </aside>

        <div className="scene-label">
          <span className="scene-label-mark">+</span>
          <div>
            月球表面<span>LUNAR REGOLITH</span>
          </div>
          <div className="scene-label-line" />
        </div>
        <aside
          className="orientation"
          aria-label={`行进航向 ${displayHeading} 度`}
        >
          <div className="compass">
            <span className="north">N</span>
            <span className="east">E</span>
            <span className="south">S</span>
            <span className="west">W</span>
            <div
              className="compass-needle"
              style={{ transform: `rotate(${telemetry.heading}deg)` }}
            >
              <span />
            </div>
            <i />
          </div>
          <span className="heading-number">
            {String(displayHeading).padStart(3, '0')}° <span>HDG</span>
          </span>
        </aside>

        <footer className="bottom-area">
          <div className="viewport-caption">
            <span className="caption-line" />
            <span>以你的视角，靠近月球</span>
            <span className="caption-number">01 / ∞</span>
          </div>
          <div className="control-dock">
            <button
              disabled={!loaded}
              className="play-button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? '暂停行驶' : '继续行驶'}
              title="空格键 · 暂停 / 继续"
            >
              {playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
            </button>
            <span className="dock-divider" />
            <ToggleGroup
              className="view-controls"
              value={[view]}
              onValueChange={(values) => {
                if (values[0]) setView(values[0] as ViewMode);
              }}
              aria-label="视角模式"
              disabled={!loaded}
            >
              <ToggleGroupItem value="follow" className="view-button">
                <Orbit size={17} />
                <span>跟随视角</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="free" className="view-button">
                <Scan size={17} />
                <span>自由探索</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="detail" className="view-button">
                <Crosshair size={17} />
                <span>近距离</span>
              </ToggleGroupItem>
            </ToggleGroup>
            <span className="dock-divider second-divider" />
            <div className="speed-control">
              <span>速度</span>
              <Slider
                className="speed-slider"
                value={[speed]}
                min={0.5}
                max={4}
                step={0.5}
                onValueChange={(value) =>
                  setSpeed(Array.isArray(value) ? value[0] : value)
                }
                aria-label="行驶速度倍数"
                disabled={!loaded}
              />
              <b>{speed.toFixed(1)}×</b>
              <Select
                value={quality}
                onValueChange={selectQuality}
                disabled={!loaded}
              >
                <SelectTrigger
                  className="quality-select"
                  aria-label="画质"
                  title={
                    quality === 'auto'
                      ? `自动画质：${QUALITY_LABELS[actualQuality]}`
                      : '画质'
                  }
                >
                  <SelectValue>{QUALITY_LABELS[quality]}</SelectValue>
                </SelectTrigger>
                <SelectContent
                  className="rover-select-menu"
                  alignItemWithTrigger={false}
                >
                  {Object.entries(QUALITY_LABELS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="dock-divider last-divider" />
            <button
              disabled={!loaded}
              className="icon-button reset-button"
              onClick={() => {
                setView('follow');
                world.current?.resetView();
              }}
              aria-label="重置视角"
              title="重置视角 · R"
            >
              <RotateCcw size={17} />
            </button>
          </div>
          <div className="bottom-meta">
            <div className="interaction-tips">
              {view === 'free' ? (
                <span>W A S D 移动 · Q E 升降 · Shift 加速</span>
              ) : (
                <>
                  <span className="mouse-tip">
                    <Mouse size={14} /> 拖动旋转
                  </span>
                  <i className="mouse-tip" />
                  <span className="mouse-tip">滚轮缩放</span>
                  <i className="mouse-tip" />
                  <span className="mouse-tip">
                    <Move size={14} /> 右键平移
                  </span>
                  <span className="touch-tip">单指旋转 · 双指缩放和平移</span>
                </>
              )}
            </div>
          </div>
        </footer>
      </div>
      {hidden && (
        <button className="restore-ui" onClick={() => setHidden(false)}>
          <Eye size={16} /> 显示界面 <kbd>H</kbd>
        </button>
      )}
      {!loaded && !error && (
        <output className="loading-scene" aria-live="polite">
          <span className="loading-orbit" />
          <span>正在抵达月面</span>
          <span className="loading-track">
            <i style={{ width: `${Math.max(5, progress)}%` }} />
          </span>
          <small>
            {phase} · {Math.round(progress)}%
          </small>
        </output>
      )}
      {error && (
        <div className="error-panel" role="alert">
          <h2>暂时无法抵达月面</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>
            重新加载 <RotateCcw size={15} />
          </button>
        </div>
      )}
      <div className="frame-corner top-left" />
      <div className="frame-corner bottom-right" />
    </main>
  );
}
