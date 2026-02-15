import { createNotifier, WasmNotifier } from '../useWasmState';

describe('createNotifier', () => {
  let notifier: WasmNotifier;

  beforeEach(() => {
    notifier = createNotifier();
  });

  describe('subscribe', () => {
    it('adds a listener and returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = notifier.subscribe(callback);

      notifier.notify();
      expect(callback).toHaveBeenCalledTimes(1);

      expect(typeof unsubscribe).toBe('function');
    });

    it('removes listener on unsubscribe so it no longer fires', () => {
      const callback = vi.fn();
      const unsubscribe = notifier.subscribe(callback);

      notifier.notify();
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      notifier.notify();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('supports multiple subscribers that all receive notifications', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      const cb3 = vi.fn();

      notifier.subscribe(cb1);
      notifier.subscribe(cb2);
      notifier.subscribe(cb3);

      notifier.notify();

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb3).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing one listener does not affect others', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const unsub1 = notifier.subscribe(cb1);
      notifier.subscribe(cb2);

      unsub1();

      notifier.notify();

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe('notify', () => {
    it('fires all listeners', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      notifier.subscribe(cb1);
      notifier.subscribe(cb2);

      notifier.notify();

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('does not throw with no listeners', () => {
      expect(() => notifier.notify()).not.toThrow();
    });
  });

  describe('batch', () => {
    it('defers notify calls and fires once at end', () => {
      const callback = vi.fn();
      notifier.subscribe(callback);

      notifier.batch(() => {
        notifier.notify();
        expect(callback).not.toHaveBeenCalled();
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('fires only once even with multiple notify calls inside', () => {
      const callback = vi.fn();
      notifier.subscribe(callback);

      notifier.batch(() => {
        notifier.notify();
        notifier.notify();
        notifier.notify();
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not fire listeners when no notify was called inside', () => {
      const callback = vi.fn();
      notifier.subscribe(callback);

      notifier.batch(() => {
        // no notify calls
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('fires listeners after exception if batch was dirty', () => {
      const callback = vi.fn();
      notifier.subscribe(callback);

      expect(() => {
        notifier.batch(() => {
          notifier.notify();
          throw new Error('boom');
        });
      }).toThrow('boom');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does not fire listeners after exception if batch was not dirty', () => {
      const callback = vi.fn();
      notifier.subscribe(callback);

      expect(() => {
        notifier.batch(() => {
          throw new Error('boom');
        });
      }).toThrow('boom');

      expect(callback).not.toHaveBeenCalled();
    });
  });
});
