/**
 * InputController — Maps user interactions to engine commands.
 *
 * Decouples DOM events from engine method calls. This makes the
 * interaction testable (mock engine, fire events, verify calls).
 *
 * Pattern: DOM event → controller method → engine.openAction/closeAction
 *
 * Usage:
 *   const input = new InputController();
 *   input.onAction('interact', {
 *     start: (params) => engine.openAction(params, Date.now()),
 *     end: () => engine.closeAction(Date.now()),
 *   });
 *   // Bind to DOM
 *   element.onmousedown = () => input.startAction('interact', { mode: 'draw' });
 *   window.onmouseup = () => input.endAction('interact');
 */

export interface ActionHandlers {
  start: (params: Record<string, unknown>) => void;
  end: () => number | void;  // Returns result value (e.g., score, delta)
}

export type ActionEndCallback = (actionName: string, result: number | void) => void;

export class InputController {
  private actions = new Map<string, ActionHandlers>();
  private activeActions = new Set<string>();
  private endCallback: ActionEndCallback | null = null;

  /** Register an action with start/end handlers */
  onAction(name: string, handlers: ActionHandlers): this {
    this.actions.set(name, handlers);
    return this;
  }

  /** Register a callback that fires when any action ends */
  onActionEnd(callback: ActionEndCallback): this {
    this.endCallback = callback;
    return this;
  }

  /** Start a named action with parameters */
  startAction(name: string, params: Record<string, unknown> = {}): void {
    const handlers = this.actions.get(name);
    if (!handlers) return;
    if (this.activeActions.has(name)) return;  // Already active

    this.activeActions.add(name);
    handlers.start(params);
  }

  /** End a named action */
  endAction(name: string): number | void {
    const handlers = this.actions.get(name);
    if (!handlers) return;
    if (!this.activeActions.has(name)) return;

    this.activeActions.delete(name);
    const result = handlers.end();
    this.endCallback?.(name, result);
    return result;
  }

  /** End all active actions (e.g., on mouseup) */
  endAllActions(): void {
    for (const name of this.activeActions) {
      this.endAction(name);
    }
  }

  /** Check if a specific action is active */
  isActive(name: string): boolean {
    return this.activeActions.has(name);
  }

  /**
   * Bind global release listeners (mouseup, touchend).
   * Returns a cleanup function for React useEffect.
   */
  bindGlobalRelease(): () => void {
    const end = () => this.endAllActions();
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
    };
  }
}
