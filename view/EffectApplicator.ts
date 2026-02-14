/**
 * EffectApplicator — Applies precomputed frame values to DOM elements.
 *
 * The WASM engine computes all CSS-relevant values (vignette alpha, border glow
 * intensity, shake magnitude, color interpolation, etc.) inside tick(). This class
 * is the "last mile" — it reads those precomputed values from the frame buffer
 * and writes them to the DOM.
 *
 * The pattern: declarative bindings, imperative application.
 *
 * At setup time, you declare bindings: "element 'root', CSS property '--vignette-alpha',
 * read from frame offset 5". At runtime (60fps), the applicator walks the binding list
 * and applies values. No conditionals, no computation — just read and write.
 *
 * Why OOP here: Different apps have different DOM structures, but the PATTERN is
 * always the same — read frame[offset], write to element.style. The class provides
 * a fluent builder API for declaring bindings and handles all the DOM write mechanics.
 *
 * Binding types:
 * - CSSProperty: Sets a CSS custom property (e.g., --vignette-alpha) via setProperty()
 * - Style: Sets an inline style property (e.g., opacity) via direct assignment
 * - Transform: Computes a transform string from a frame value (e.g., shake → translate)
 * - Conditional: Switches between binding sets based on a boolean frame flag
 *
 * Usage:
 *   const effects = new EffectApplicator();
 *   effects.bindCSSProperty('root', '--vignette-alpha', F.VIG_ALPHA);
 *   effects.bindTransform('chart', F.SHAKE_INTENSITY, (v) => {
 *     const sx = (Math.random() - 0.5) * 2 * v;
 *     const sy = (Math.random() - 0.5) * 2 * v;
 *     return `translate(${sx}px, ${sy}px)`;
 *   });
 *   effects.bind('root', document.getElementById('app')!);
 *   // Then in animation loop: effects.onFrame(frame, nowMs);
 */

import type { IFrameConsumer } from '../core/interfaces';
import type { CSSEffect } from '../core/types';

/** A binding that sets a CSS custom property via element.style.setProperty() */
interface CSSPropertyBinding {
  type: 'css';
  elementName: string;
  property: string;
  offset: number;
  format?: (value: number) => string;
}

/** A binding that sets an inline style property via direct assignment */
interface StylePropertyBinding {
  type: 'style';
  elementName: string;
  property: string;
  offset: number;
  format?: (value: number) => string;
}

/** A binding that computes a CSS transform from a frame value */
interface TransformBinding {
  type: 'transform';
  elementName: string;
  offset: number;
  compute: (value: number) => string;
  threshold?: number;
}

/** A binding that switches between sub-bindings based on a boolean frame flag */
interface ConditionalBinding {
  type: 'conditional';
  flagOffset: number;
  onTrue: SimpleBinding[];
  onFalse?: SimpleBinding[];
}

/** Any non-conditional binding (used inside ConditionalBinding) */
type SimpleBinding = CSSPropertyBinding | StylePropertyBinding | TransformBinding;

/** All binding types */
type Binding = SimpleBinding | ConditionalBinding;

export class EffectApplicator implements IFrameConsumer {
  readonly priority = 10;
  private elements = new Map<string, HTMLElement>();
  private bindings: Binding[] = [];

  /** Bind a named DOM element for effect application. */
  bind(name: string, element: HTMLElement): void {
    this.elements.set(name, element);
  }

  /** Remove a named element binding. */
  unbind(name: string): void {
    this.elements.delete(name);
  }

  /**
   * Bind a CSS custom property to a frame buffer offset.
   *
   * CSS custom properties (--foo) are set via element.style.setProperty().
   * Use the optional format function to convert the raw f64 to a CSS value
   * string (e.g., adding units or clamping). Default: String(value).
   *
   * @returns this, for fluent chaining
   */
  bindCSSProperty(elementName: string, property: string, offset: number, format?: (v: number) => string): this {
    this.bindings.push({ type: 'css', elementName, property, offset, format });
    return this;
  }

  /**
   * Bind an inline style property to a frame buffer offset.
   *
   * Inline styles (element.style.opacity, etc.) are set via direct assignment.
   * Use for standard CSS properties that don't use the custom property syntax.
   *
   * @returns this, for fluent chaining
   */
  bindStyle(elementName: string, property: string, offset: number, format?: (v: number) => string): this {
    this.bindings.push({ type: 'style', elementName, property, offset, format });
    return this;
  }

  /**
   * Bind a CSS transform computed from a frame value.
   *
   * The compute function receives the raw f64 value and returns a CSS transform
   * string (e.g., "translate(3px, -1px)"). If the value is at or below the
   * threshold, the transform is cleared (set to empty string) to avoid
   * unnecessary compositing layers.
   *
   * @param threshold - Only apply if value > threshold (default: 0)
   * @returns this, for fluent chaining
   */
  bindTransform(elementName: string, offset: number, compute: (v: number) => string, threshold = 0): this {
    this.bindings.push({ type: 'transform', elementName, offset, compute, threshold });
    return this;
  }

  /**
   * Bind effects that switch based on a boolean flag in the frame buffer.
   *
   * When frame[flagOffset] > 0.5, onTrue bindings are applied. Otherwise,
   * onFalse bindings are applied (if provided). Use for states like
   * "active" vs "inactive" that require different visual treatments.
   *
   * @returns this, for fluent chaining
   */
  bindConditional(flagOffset: number, onTrue: SimpleBinding[], onFalse?: SimpleBinding[]): this {
    this.bindings.push({ type: 'conditional', flagOffset, onTrue, onFalse });
    return this;
  }

  /**
   * Get all CSS effects that would be applied for a given frame.
   *
   * Useful for testing or for consumers that want to batch CSS writes
   * themselves rather than letting the applicator mutate the DOM directly.
   */
  getCSSEffects(frame: Float64Array): CSSEffect[] {
    const effects: CSSEffect[] = [];
    for (const binding of this.bindings) {
      this.collectCSSEffects(binding, frame, effects);
    }
    return effects;
  }

  /** Apply all bindings for a frame. Called at 60fps by the animation loop. */
  onFrame(frame: Float64Array, _nowMs: number): void {
    for (const binding of this.bindings) {
      this.applyBinding(binding, frame);
    }
  }

  private applyBinding(binding: Binding, frame: Float64Array): void {
    switch (binding.type) {
      case 'css': {
        const el = this.elements.get(binding.elementName);
        if (!el) return;
        const value = binding.format
          ? binding.format(frame[binding.offset])
          : String(frame[binding.offset]);
        el.style.setProperty(binding.property, value);
        break;
      }
      case 'style': {
        const el = this.elements.get(binding.elementName);
        if (!el) return;
        const value = binding.format
          ? binding.format(frame[binding.offset])
          : String(frame[binding.offset]);
        (el.style as unknown as Record<string, string>)[binding.property] = value;
        break;
      }
      case 'transform': {
        const el = this.elements.get(binding.elementName);
        if (!el) return;
        const v = frame[binding.offset];
        if (v > (binding.threshold ?? 0)) {
          el.style.transform = binding.compute(v);
        } else {
          el.style.transform = '';
        }
        break;
      }
      case 'conditional': {
        const flag = frame[binding.flagOffset] > 0.5;
        const activeBindings = flag ? binding.onTrue : (binding.onFalse ?? []);
        for (const b of activeBindings) {
          this.applyBinding(b, frame);
        }
        break;
      }
    }
  }

  private collectCSSEffects(binding: Binding, frame: Float64Array, effects: CSSEffect[]): void {
    switch (binding.type) {
      case 'css': {
        const value = binding.format
          ? binding.format(frame[binding.offset])
          : String(frame[binding.offset]);
        effects.push({ property: binding.property, value });
        break;
      }
      case 'conditional': {
        const flag = frame[binding.flagOffset] > 0.5;
        const activeBindings = flag ? binding.onTrue : (binding.onFalse ?? []);
        for (const b of activeBindings) {
          this.collectCSSEffects(b, frame, effects);
        }
        break;
      }
      default:
        break;
    }
  }
}
