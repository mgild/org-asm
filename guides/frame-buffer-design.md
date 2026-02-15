# Guide: Frame Buffer Design

## When to Use
When designing the `tick()` return value for a WASM engine. This is the contract between Rust and TypeScript -- getting it right is critical because both sides must agree on offsets.

## Design Process

### Step 1: List All Values the View Needs
Walk through your render loop and list every value read from state:
- Animation values (opacity, scale, position, blend factors)
- CSS custom properties (vignette alpha, border glow, scanline intensity)
- Computed display values (numeric data, percentages, derived amounts)
- Boolean flags (is active, action direction, auto-ended, value direction)
- Color components (r, g, b as separate f64s)
- Timing values (elapsed, remaining, progress percentage)

### Step 2: Assign Offsets in Rust
Group by category. Use constants with prefix `F_`:

```rust
// Animation state
const F_INTENSITY: usize = 0;
const F_SMOOTH_INTENSITY: usize = 1;
const F_T_RAMP: usize = 2;
const F_ACTION_BLEND: usize = 3;
const F_BEAT: usize = 4;
const F_PULSE: usize = 5;
const F_Y_PAD: usize = 6;
const F_BEAT_PHASE: usize = 7;
const F_ACTION_FLASH: usize = 8;

// Colors (each component is a separate f64, 0-255 range)
const F_STATE_R: usize = 9;
const F_STATE_G: usize = 10;
const F_STATE_B: usize = 11;

// Boolean flags (encoded as 0.0 or 1.0)
const F_IS_ACTIVE: usize = 12;
const F_ACTION_DIRECTION: usize = 13;
const F_AUTO_ENDED: usize = 22;
const F_VALUE_DIRECTION: usize = 35;

// Display values
const F_CURRENT_VALUE: usize = 14;
const F_ACTION_VALUE: usize = 15;
const F_RESULT_PERCENT: usize = 18;
const F_RESULT_VALUE: usize = 19;

// CSS effect values (precomputed, ready to apply)
const F_VIG_SPREAD: usize = 23;
const F_VIG_ALPHA: usize = 24;
const F_BG_PULSE_ALPHA: usize = 25;
const F_BORDER_ALPHA: usize = 26;
const F_SCANLINE_ALPHA: usize = 27;
const F_SHAKE_INTENSITY: usize = 28;

// Meta
const FRAME_SIZE: usize = 39;
```

### Step 3: Mirror in TypeScript
Create a frozen const object with matching offsets:

```ts
const F = {
  INTENSITY: 0,
  SMOOTH_INTENSITY: 1,
  T_RAMP: 2,
  ACTION_BLEND: 3,
  BEAT: 4,
  PULSE: 5,
  Y_PAD: 6,
  BEAT_PHASE: 7,
  ACTION_FLASH: 8,
  STATE_R: 9,
  STATE_G: 10,
  STATE_B: 11,
  IS_ACTIVE: 12,
  ACTION_DIRECTION: 13,
  CURRENT_VALUE: 14,
  ACTION_VALUE: 15,
  // ... etc
} as const;
```

Or use the framework's FrameBufferFactory for validation:

```ts
import { FrameBufferFactory } from '../framework/core';

const schema = FrameBufferFactory.createSchema([
  { name: 'CURRENT_VALUE', offset: 0, type: 'f64' },
  { name: 'IS_ACTIVE', offset: 1, type: 'bool' },
  { name: 'STATE_R', offset: 2, type: 'u8' },
]);
const offsets = FrameBufferFactory.createOffsets(schema);
// offsets.CURRENT_VALUE === 0, offsets.IS_ACTIVE === 1, etc.
```

### Step 4: Read in the View
```ts
const frame = engine.tick(Date.now());

// Booleans: compare > 0.5 (not === 1.0, floating point is inexact)
if (frame[F.IS_ACTIVE] > 0.5) { ... }
if (frame[F.AUTO_ENDED] > 0.5) { ... }

// Colors: round to integer for RGB strings
const r = Math.round(frame[F.STATE_R]);
const g = Math.round(frame[F.STATE_G]);
const b = Math.round(frame[F.STATE_B]);
ctx.strokeStyle = `rgba(${r},${g},${b},1)`;

// CSS properties: use String() for direct assignment
el.style.setProperty('--vignette-alpha', String(frame[F.VIG_ALPHA]));

// Numeric values: use directly
chart.setScale('x', {
    min: nowSec - frame[F.WINDOW_SECONDS],
    max: nowSec,
});
```

## Conventions
- **Booleans** stored as `0.0` / `1.0`, read with `> 0.5` (never `=== 1.0`)
- **Colors** stored as `0-255` f64, round with `Math.round()` when building CSS strings
- **All values are f64** (WASM native number type, maps to JS number)
- **Offsets are sequential** starting at 0
- **FRAME_SIZE** = max offset + 1
- **Rust owns the truth**: Rust constants are the source, JS mirrors them
- **One-frame flags**: If a flag should fire once (like AUTO_ENDED), the engine must clear it on the next tick or JS must handle idempotently

## Precomputing CSS Effects
Compute CSS-ready values INSIDE the engine, not in JS. This moves branching and math into Rust where it runs once, rather than in JS where it runs in the hot render path:

```rust
// In tick():
let blend = self.action_blend;
let pulse = self.pulse;
let t_r = self.t_ramp;

// Vignette effect: combines blend, ramp, and pulse
frame[F_VIG_SPREAD] = 50.0 - t_r * 18.0 - pulse * t_r * 5.0;
frame[F_VIG_ALPHA] = blend * (0.3 + 0.3 * t_r + 0.2 * pulse * t_r);

// Border glow: pulses with beat
frame[F_BORDER_ALPHA] = blend * (0.1 + 0.35 * pulse * t_r);

// Scanline overlay
frame[F_SCANLINE_ALPHA] = blend * (0.015 + t_r * 0.03);

// Shake: computed from beat phase and t_ramp
let shake_beat = (self.beat_phase * PI).sin();
frame[F_SHAKE_INTENSITY] = t_r * SHAKE_MAX_PX * (0.3 + 0.7 * shake_beat * shake_beat);
```

JS just applies the precomputed values:
```ts
const s = appRef.current.style;
s.setProperty('--vignette-spread', `${frame[F.VIG_SPREAD]}%`);
s.setProperty('--vignette-alpha', String(frame[F.VIG_ALPHA]));
s.setProperty('--border-glow-alpha', String(frame[F.BORDER_ALPHA]));
s.setProperty('--scanline-alpha', String(frame[F.SCANLINE_ALPHA]));
```

## Framework Support: EffectApplicator
The framework provides a declarative binding layer so you do not need to write manual DOM mutations:

```ts
const effects = new EffectApplicator();
effects
  .bindCSSProperty('root', '--vignette-alpha', F.VIG_ALPHA)
  .bindCSSProperty('root', '--vignette-spread', F.VIG_SPREAD, v => `${v}%`)
  .bindCSSProperty('root', '--border-glow-alpha', F.BORDER_ALPHA)
  .bindTransform('chart', F.SHAKE_INTENSITY, (v) => {
    const sx = (Math.random() - 0.5) * 2 * v;
    const sy = (Math.random() - 0.5) * 2 * v;
    return `translate(${sx}px, ${sy}px)`;
  })
  .bindConditional(F.IS_ACTIVE, [
    { type: 'style', elementName: 'result', property: 'transform', offset: F.RESULT_SCALE,
      format: v => `scale(${v})` },
  ]);

effects.bind('root', document.getElementById('app')!);
effects.bind('chart', chartContainer);
effects.bind('result', resultElement);
```

## Adding a New Field
1. Add `const F_NEW_FIELD: usize = FRAME_SIZE;` in Rust (use current FRAME_SIZE as the offset)
2. Increment `FRAME_SIZE` by 1
3. Compute the value inside `tick()` and assign `frame[F_NEW_FIELD] = value;`
4. Add `NEW_FIELD: <offset>` to the JS `F` object
5. Read `frame[F.NEW_FIELD]` in the render code

Keep both sides in the same commit to prevent drift.

---

See also: [wasm-engine-pattern](wasm-engine-pattern.md), [realtime-rendering](realtime-rendering.md)
