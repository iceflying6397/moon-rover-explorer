/** Keep a complete vehicle inside the narrower of the two viewing angles. */
export function framingScale(
  radius: number,
  aspect: number,
  modelScale: number,
  fov = 40,
) {
  const halfVertical = (fov * Math.PI) / 360;
  const halfAngle = Math.min(
    halfVertical,
    Math.atan(Math.tan(halfVertical) * Math.max(0.1, aspect)),
  );
  const minimumDistance = (radius / Math.sin(halfAngle)) * 1.08;
  return Math.max(modelScale, minimumDistance / Math.hypot(4.7, 2.9, 5.7));
}

export type ShortcutModifiers = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
};
export function shortcutBlocked(state: ShortcutModifiers) {
  return Boolean(
    state.ctrlKey ||
    state.metaKey ||
    state.altKey ||
    state.defaultPrevented ||
    state.isComposing,
  );
}

export function pageShortcut(
  code: string,
  state: ShortcutModifiers & {
    repeat: boolean;
    editing: boolean;
    modalOpen: boolean;
    buttonFocused: boolean;
  },
) {
  if (
    shortcutBlocked(state) ||
    state.repeat ||
    state.editing ||
    state.modalOpen
  )
    return null;
  if (code === 'KeyH') return 'interface';
  if (code === 'KeyR') return 'reset';
  // Space belongs to a focused button; H and R remain available after a click.
  if (code === 'Space' && !state.buttonFocused) return 'play';
  return null;
}

/** Simulation uses active wall time; only camera easing has a bounded step. */
export function frameDelta(previous: number, now: number) {
  const elapsed = Math.max(0, (now - previous) / 1000);
  return { elapsed, smoothing: Math.min(elapsed, 0.05) };
}

/** Base UI may retain a zero-size listbox after closing its visible popup. */
export function hasOpenOverlay() {
  return Array.from(
    document.querySelectorAll('[role="dialog"], [role="listbox"]'),
  ).some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}
