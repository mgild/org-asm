# Intl Engine Pattern

Rust-owned internationalization with locale management, message catalogs, fallback chain, pluralization, and missing key tracking. The WASM engine owns ALL i18n state -- current locale, loaded messages, fallback chain, translation resolution, missing key detection. TypeScript is a dumb dispatcher that triggers locale changes and reads translated strings back.

## When to Use

Use the intl engine when your app has:
- Multi-language support with Rust-owned locale state
- Message catalogs loaded per locale with fallback chains
- Pluralization rules that vary by locale
- Missing translation key tracking for development/debugging

NOT for simple static label maps or server-rendered i18n. For those, use plain `useWasmState` with a flat snapshot.

## Quick Start

### 1. Implement IIntlEngine in Rust

Copy the template:

```bash
cp node_modules/org-asm/model/intl-engine-template.rs crates/my-engine/src/intl.rs
```

Customize two things:

1. **Pluralization rules** in `translate_plural()` -- define CLDR plural categories for your locales
2. **Fallback chain** -- configure which locales to fall back to when a key is missing

```rust
fn translate_plural(&self, key: &str, count: u32) -> String {
    let category = match self.locale.as_str() {
        "en" | "de" => if count == 1 { "one" } else { "other" },
        "ar" => cldr_arabic_plural(count),
        _ => if count == 1 { "one" } else { "other" },
    };
    let plural_key = format!("{}.{}", key, category);
    self.translate(&plural_key)
}
```

### 2. Wire with React Hooks

```tsx
import { useIntlEngine, useIntlState, useTranslation } from 'org-asm/react';

function App() {
  const engine = useMemo(() => new MyIntlEngine(), []);
  const handle = useIntlEngine(engine);

  // Load messages on mount
  useEffect(() => {
    if (!handle) return;
    handle.setLocale('en');
    handle.loadMessages(JSON.stringify(enMessages));
  }, [handle]);

  return (
    <div>
      <LocaleSwitcher handle={handle} />
      <Greeting handle={handle} />
      <ItemCount handle={handle} count={5} />
    </div>
  );
}

function LocaleSwitcher({ handle }: { handle: IntlHandle | null }) {
  const { locale, missingKeyCount } = useIntlState(handle);
  return (
    <div>
      <span>Locale: {locale}</span>
      {missingKeyCount > 0 && <span> ({missingKeyCount} missing keys)</span>}
      <button onClick={() => {
        handle?.setLocale('es');
        handle?.loadMessages(JSON.stringify(esMessages));
      }}>Espanol</button>
      <button onClick={() => {
        handle?.setLocale('en');
        handle?.loadMessages(JSON.stringify(enMessages));
      }}>English</button>
    </div>
  );
}

function Greeting({ handle }: { handle: IntlHandle | null }) {
  const { value, missing } = useTranslation(handle, 'greeting.hello');
  return (
    <div>
      {missing ? <span style={{ color: 'red' }}>[MISSING] {value}</span> : <span>{value}</span>}
    </div>
  );
}

function ItemCount({ handle, count }: { handle: IntlHandle | null; count: number }) {
  const translated = handle?.translatePlural('items.count', count) ?? '';
  return <span>{translated}</span>;
}
```

### 3. Context (optional -- no prop drilling)

```tsx
import { createIntlContext } from 'org-asm/react';

const { IntlProvider, useIntl, useIntlStatus, useTranslation } = createIntlContext<MyIntlEngine>();

function App() {
  const engine = useMemo(() => new MyIntlEngine(), []);
  return (
    <IntlProvider engine={engine}>
      <AppShell />
    </IntlProvider>
  );
}

function LocaleDisplay() {
  const { locale, missingKeyCount } = useIntlStatus();
  return <span>{locale} ({missingKeyCount} missing)</span>;
}

function Label({ messageKey }: { messageKey: string }) {
  const { value, missing } = useTranslation(messageKey);
  return <span className={missing ? 'missing-key' : ''}>{value}</span>;
}

function Actions() {
  const { setLocale, loadMessages } = useIntl();
  return (
    <button onClick={() => { setLocale('fr'); loadMessages(JSON.stringify(frMessages)); }}>
      Francais
    </button>
  );
}
```

## IIntlEngine Contract

### Locale Management

| Method | Type | Description |
|--------|------|-------------|
| `set_locale(locale)` | `&mut self` | Set the active locale, bump version |
| `add_locale(locale)` | `&mut self` | Register a locale as available, bump version |
| `set_fallback_locale(locale)` | `&mut self` | Set the fallback locale for missing keys, bump version |

### Message Catalogs

| Method | Type | Description |
|--------|------|-------------|
| `load_messages(json)` | `&mut self` | Load message catalog (JSON object of key-value pairs) for current locale, bump version |
| `clear_messages()` | `&mut self` | Remove all messages for current locale, bump version |

### Translation

| Method | Type | Description |
|--------|------|-------------|
| `translate(key)` | `&self` | Resolve key to translated string (falls back through chain, tracks missing) |
| `translate_with_params(key, params_json)` | `&self` | Translate with interpolation parameters as JSON object |
| `translate_plural(key, count)` | `&self` | Pluralized translation using CLDR rules for current locale |

### State

| Method | Type | Description |
|--------|------|-------------|
| `get_intl_state()` | `&self` | Full snapshot as IntlState |
| `data_version()` | `&self` | Monotonically increasing change counter |
| `reset()` | `&mut self` | Reset all state to defaults (no locale, no messages) |

## Fallback Chain

When a translation key is not found in the current locale, the engine walks the fallback chain:

```
Current locale ("fr-CA")
    ↓ not found
Base locale ("fr")
    ↓ not found
Fallback locale ("en")
    ↓ not found
Returns key itself + tracks as missing
```

Configure the chain at initialization:

```ts
handle?.setLocale('fr-CA');
handle?.setFallbackLocale('en');
// Engine automatically derives fr-CA → fr → en
```

## Missing Key Tracking

The engine tracks every key that could not be resolved. This is useful for development:

```ts
const { missingKeyCount } = useIntlState(handle);

// In dev mode, show a badge with missing key count
if (process.env.NODE_ENV === 'development' && missingKeyCount > 0) {
  console.warn(`${missingKeyCount} missing translation keys`);
}
```

## Parameter Interpolation

Pass parameters as a JSON object to replace placeholders in messages:

```ts
// Message catalog: { "welcome": "Hello, {name}! You have {count} items." }
const translated = handle?.translateWithParams(
  'welcome',
  JSON.stringify({ name: 'Alice', count: '5' })
);
// "Hello, Alice! You have 5 items."
```

## Types

### IntlState

```typescript
interface IntlState {
  locale: string;              // Current active locale (empty if not set)
  fallbackLocale: string;      // Fallback locale (empty if not set)
  localeCount: number;         // Number of registered locales
  messageCount: number;        // Number of loaded message keys
  missingKeyCount: number;     // Number of keys that failed resolution
}
```

### TranslationState

```typescript
interface TranslationState {
  key: string;                 // The translation key
  value: string;               // Resolved translation (or the key itself if missing)
  missing: boolean;            // Whether the key was not found in any locale
}
```

## Testing

Mock the engine in tests with a plain JS object:

```typescript
function createMockIntlEngine(): IIntlEngine {
  let _locale = '';
  let _fallbackLocale = '';
  let _dataVersion = 0;
  const _locales = new Set<string>();
  const _messages = new Map<string, Map<string, string>>();
  const _missingKeys = new Set<string>();

  const resolve = (key: string): string | undefined => {
    const localeMessages = _messages.get(_locale);
    if (localeMessages?.has(key)) return localeMessages.get(key)!;
    const fallbackMessages = _messages.get(_fallbackLocale);
    if (fallbackMessages?.has(key)) return fallbackMessages.get(key)!;
    return undefined;
  };

  return {
    set_locale: (locale: string) => { _locale = locale; _dataVersion++; },
    add_locale: (locale: string) => { _locales.add(locale); _dataVersion++; },
    set_fallback_locale: (locale: string) => { _fallbackLocale = locale; _dataVersion++; },
    load_messages: (json: string) => {
      const msgs = JSON.parse(json);
      if (!_messages.has(_locale)) _messages.set(_locale, new Map());
      const localeMap = _messages.get(_locale)!;
      Object.entries(msgs).forEach(([k, v]) => localeMap.set(k, v as string));
      _dataVersion++;
    },
    clear_messages: () => { _messages.delete(_locale); _dataVersion++; },
    translate: (key: string) => {
      const val = resolve(key);
      if (val === undefined) { _missingKeys.add(key); return key; }
      return val;
    },
    translate_with_params: (key: string, paramsJson: string) => {
      let val = resolve(key) ?? key;
      const params = JSON.parse(paramsJson);
      Object.entries(params).forEach(([k, v]) => { val = val.replace(`{${k}}`, v as string); });
      return val;
    },
    translate_plural: (key: string, count: number) => {
      const category = count === 1 ? 'one' : 'other';
      const pluralKey = `${key}.${category}`;
      return resolve(pluralKey) ?? pluralKey;
    },
    get_intl_state: () => ({
      locale: _locale,
      fallbackLocale: _fallbackLocale,
      localeCount: _locales.size,
      messageCount: _messages.get(_locale)?.size ?? 0,
      missingKeyCount: _missingKeys.size,
    }),
    data_version: () => _dataVersion,
    reset: () => {
      _locale = ''; _fallbackLocale = '';
      _locales.clear(); _messages.clear(); _missingKeys.clear();
      _dataVersion++;
    },
  } as IIntlEngine;
}
```

Use `renderHook` from `@testing-library/react` to test hooks in isolation. The intl engine hooks follow the same testing patterns as `useWasmState` and `useWasmSelector`.
