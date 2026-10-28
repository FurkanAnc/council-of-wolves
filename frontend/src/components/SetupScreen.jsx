import { useState } from 'react';
import Icon from './Icon';
import { api } from '../api';
import { memberColor, memberInitial } from '../utils/labels';
import './SetupScreen.css';

// Provider presets; "custom" takes any Anthropic-compatible URL
const PROVIDERS = [
  {
    id: 'yeta',
    name: 'yeta.ai',
    description: 'DeepSeek ve diğer modeller, Anthropic uyumlu',
    baseUrl: 'https://platform.yeta.ai',
    model: 'deepseek-v4.1-flash',
    models: ['deepseek-v4.1-flash', 'koray-1.0'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude modelleri (Opus, Sonnet)',
    baseUrl: '',
    model: '',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  },
  {
    id: 'custom',
    name: 'Diğer',
    description: 'Anthropic uyumlu başka bir sağlayıcı',
    baseUrl: '',
    model: '',
    models: [],
  },
];

function providerFor(baseUrl) {
  if (!baseUrl) return 'anthropic';
  return PROVIDERS.find((p) => p.baseUrl && baseUrl.startsWith(p.baseUrl))?.id || 'custom';
}

const FEATURES = [
  { icon: 'users', title: 'Farklı rollerde üyeler', text: 'Uzman, Şüpheci, Pratik ve Şeytanın Avukatı sorunuzu kendi açısından cevaplar.' },
  { icon: 'chat', title: 'Tartışma ve anonim değerlendirme', text: 'Üyeler birbirine cevap verir, sonra birbirlerinin cevaplarını isim görmeden puanlar.' },
  { icon: 'sparkle', title: 'Tek bir güçlü cevap', text: 'Başkan tüm görüşleri tartıp en iyi son cevabı yazar.' },
];

function Steps({ step }) {
  const labels = ['Hoş geldiniz', 'Bağlantı', 'Hazır'];
  return (
    <ol className="setup-steps" aria-label="Kurulum adımları">
      {labels.map((label, i) => (
        <li key={label} className={`setup-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}>
          <span className="setup-step-dot">{i < step ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}</span>
          <span className="setup-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * First-run setup (and "change connection" when `existing` is given).
 * The key goes to the local backend only, which tests it before saving it encrypted.
 */
export default function SetupScreen({ existing, council, onDone, onCancel, onForget, welcome = false, onEnter }) {
  const editing = Boolean(existing?.configured);
  // `welcome`: already connected, shown as the opening page on every launch
  const returning = welcome && editing;
  // Values found in environment variables pre-fill the first-run form
  const envHint = existing?.env_key_hint;
  const prefill = editing || (envHint && existing?.base_url);
  const [step, setStep] = useState(editing && !returning ? 1 : 0);
  const [provider, setProvider] = useState(prefill ? providerFor(existing.base_url) : 'yeta');
  const preset = PROVIDERS.find((p) => p.id === provider);
  const [baseUrl, setBaseUrl] = useState(prefill ? existing.base_url || '' : PROVIDERS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(
    editing ? existing.model || '' : (prefill && existing.model) || PROVIDERS.find((p) => p.id === (prefill ? providerFor(existing.base_url) : 'yeta')).model
  );
  const [maxTokens, setMaxTokens] = useState(editing ? String(existing.max_tokens || '') : '');
  const [chairmanTokens, setChairmanTokens] = useState(editing ? String(existing.chairman_max_tokens || '') : '');
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const chooseProvider = (id) => {
    const p = PROVIDERS.find((x) => x.id === id);
    setProvider(id);
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setError(null);
  };

  const keyRequired = !editing && !envHint;
  const canConnect = (apiKey.trim() || !keyRequired) && (provider !== 'custom' || baseUrl.trim()) && !testing;

  const connect = async (e) => {
    e.preventDefault();
    if (!canConnect) return;
    setTesting(true);
    setError(null);
    try {
      const toInt = (v) => (String(v).trim() ? Number(v) : null);
      const res = await api.saveSetup({
        base_url: provider === 'anthropic' ? null : baseUrl.trim(),
        api_key: apiKey.trim() || null,
        model: model.trim() || null,
        max_tokens: toInt(maxTokens),
        chairman_max_tokens: toInt(chairmanTokens),
      });
      setApiKey('');
      setResult(res);
      if (editing) onDone(res);
      else setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const defaultTokens = provider === 'anthropic' ? '16000 / 32000' : '8192 / 8192';

  return (
    <div className={editing && !returning ? 'setup-overlay' : 'setup-page'}>
      <div
        className="setup-card"
        role={editing && !returning ? 'dialog' : undefined}
        aria-modal={(editing && !returning) || undefined}
      >
        {!editing && <Steps step={step} />}

        {step === 0 && (
          <div className="setup-body setup-welcome">
            <img className="setup-logo" src="/logo.png" alt="Kurtlar Konseyi logosu" />
            <h1>{returning ? 'Tekrar hoş geldiniz' : 'Kurtlar Konseyi’ne hoş geldiniz'}</h1>
            <p className="setup-lead">Tek bir yapay zekâya sormak yerine, bir konseye danışın.</p>
            <ul className="setup-features">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <span className="setup-feature-icon">
                    <Icon name={f.icon} size={18} />
                  </span>
                  <span>
                    <strong>{f.title}</strong>
                    <span className="setup-feature-text">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            {returning ? (
              <>
                <button className="btn btn-primary setup-cta" onClick={onEnter} autoFocus>
                  Konseye gir <Icon name="chevron" size={16} />
                </button>
                <div className="setup-connection">
                  <span className="setup-connection-dot" aria-hidden="true">
                    <Icon name="check" size={10} strokeWidth={3.2} />
                  </span>
                  <span>
                    {existing.provider}
                    {existing.model ? ` · ${existing.model}` : ''}
                  </span>
                  <button className="setup-link" onClick={() => setStep(1)}>
                    Bağlantıyı değiştir
                  </button>
                </div>
              </>
            ) : (
              <button className="btn btn-primary setup-cta" onClick={() => setStep(1)} autoFocus>
                Başlayalım <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
        )}

        {step === 1 && (
          <form className="setup-body" onSubmit={connect}>
            <h2>{editing ? 'Bağlantıyı değiştir' : 'API bağlantısı'}</h2>
            <p className="setup-sub">
              Konsey üyeleri bir yapay zekâ sağlayıcısı üzerinden çalışır. Sağlayıcınızı seçip API anahtarınızı girin.
            </p>

            <div className="provider-grid" role="radiogroup" aria-label="Sağlayıcı">
              {PROVIDERS.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  role="radio"
                  aria-checked={provider === p.id}
                  className={`provider-card ${provider === p.id ? 'active' : ''}`}
                  onClick={() => chooseProvider(p.id)}
                >
                  <span className="provider-name">{p.name}</span>
                  <span className="provider-desc">{p.description}</span>
                </button>
              ))}
            </div>

            {provider === 'custom' && (
              <label className="setup-field">
                <span>Sağlayıcı adresi</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://..."
                  inputMode="url"
                />
              </label>
            )}

            <label className="setup-field">
              <span>API anahtarı</span>
              <div className="key-input">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    editing && existing.key_hint
                      ? `Kayıtlı anahtar ${existing.key_hint} (değiştirmek için yenisini girin)`
                      : envHint
                        ? `Bilgisayarınızdaki anahtar ${envHint} (boş bırakırsanız o kullanılır)`
                        : 'sk-...'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Anahtarı gizle' : 'Anahtarı göster'}
                  title={showKey ? 'Gizle' : 'Göster'}
                >
                  <Icon name={showKey ? 'eyeOff' : 'eye'} size={17} />
                </button>
              </div>
              <span className="setup-hint">
                <Icon name="lock" size={12} /> Anahtar yalnızca bu bilgisayarda, Windows şifrelemesiyle saklanır ve tarayıcıya
                geri gönderilmez.
              </span>
            </label>

            <label className="setup-field">
              <span>Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                list="setup-models"
                placeholder={provider === 'anthropic' ? 'Boş bırakın: Opus + Sonnet karışık konsey' : 'Model adı'}
              />
              <datalist id="setup-models">
                {preset.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <span className="setup-hint">Boş bırakılmazsa tüm üyeler bu modeli kullanır. Üyeleri sonra Ayarlar’dan ayrı ayrı değiştirebilirsiniz.</span>
            </label>

            <button type="button" className="setup-advanced-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
              <Icon name="chevron" size={14} className={advanced ? 'rotated' : ''} /> Gelişmiş: token limitleri
            </button>
            {advanced && (
              <div className="setup-row">
                <label className="setup-field">
                  <span>Max tokens (üyeler)</span>
                  <input type="number" min={256} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder={defaultTokens.split(' / ')[0]} />
                </label>
                <label className="setup-field">
                  <span>Max tokens (Başkan)</span>
                  <input type="number" min={256} value={chairmanTokens} onChange={(e) => setChairmanTokens(e.target.value)} placeholder={defaultTokens.split(' / ')[1]} />
                </label>
              </div>
            )}

            {error && (
              <div className="setup-error" role="alert">
                <Icon name="alert" size={16} />
                <span>
                  <strong>Bağlanılamadı.</strong> {error}
                </span>
              </div>
            )}

            <div className="setup-actions">
              {editing ? (
                <>
                  <button type="button" className="setup-forget" onClick={onForget}>
                    Kayıtlı anahtarı sil
                  </button>
                  <span className="setup-spacer" />
                  <button type="button" className="btn btn-ghost" onClick={returning ? () => setStep(0) : onCancel}>
                    İptal
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
                  Geri
                </button>
              )}
              <button type="submit" className="btn btn-primary" disabled={!canConnect}>
                {testing ? (
                  <>
                    <span className="spinner tiny" /> Bağlantı test ediliyor…
                  </>
                ) : editing ? (
                  'Test et ve kaydet'
                ) : (
                  'Bağlan ve devam et'
                )}
              </button>
            </div>
          </form>
        )}

        {step === 2 && result && (
          <div className="setup-body setup-done">
            <span className="setup-done-icon">
              <Icon name="check" size={28} strokeWidth={2.6} />
            </span>
            <h2>Bağlantı kuruldu</h2>
            <p className="setup-sub">
              {result.provider}
              {result.model ? ` · ${result.model}` : ''}
              {result.latency_ms != null ? ` · ${result.latency_ms} ms` : ''}
            </p>
            {council && (
              <div className="setup-council">
                {[...council.members, council.chairman].map((m) => (
                  <span key={m.id} className="setup-member">
                    <span className="avatar small" style={{ '--member-color': memberColor(m.id) }}>
                      {memberInitial(m)}
                    </span>
                    {m.name}
                  </span>
                ))}
              </div>
            )}
            <p className="setup-sub">Konseyi istediğiniz zaman Ayarlar’dan düzenleyebilirsiniz.</p>
            <button className="btn btn-primary setup-cta" onClick={() => onDone(result)} autoFocus>
              Konseye danış <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
