import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { ConnectionCard } from './ConnectionStatus';
import { api } from '../api';
import { colorVar, memberInitial } from '../utils/labels';
import './SettingsModal.css';

// Ready-made roles for new members
const TEMPLATES = [
  {
    name: 'Etikçi',
    description: 'Etik, toplumsal ve hukuki etkileri değerlendirir',
    role:
      'Your role: THE ETHICIST. Answer the question, but examine its ethical, social and legal implications: who could be harmed or helped, what values are in tension, and what a responsible choice looks like. Be concrete, not preachy.',
  },
  {
    name: 'Yaratıcı',
    description: 'Alışılmadık ve yaratıcı çözümler önerir',
    role:
      'Your role: THE CREATIVE. Propose unconventional, imaginative approaches the others are unlikely to suggest. Reframe the problem, combine ideas from other fields, and offer at least one bold option, while noting how practical each idea is.',
  },
  {
    name: 'Veri Analisti',
    description: 'Sayılara, verilere ve ölçülebilir kanıtlara dayanır',
    role:
      'Your role: THE ANALYST. Ground your answer in numbers, data and measurable evidence. Give estimates with ranges, explain the assumptions behind them, and say what data would change your conclusion.',
  },
  {
    name: 'Öğretmen',
    description: 'Konuyu en sade hâliyle anlatır',
    role:
      'Your role: THE TEACHER. Explain the topic as simply and clearly as possible, as if to a curious beginner. Use analogies and short examples, define jargon, and build from the basics to the answer.',
  },
  {
    name: 'Kullanıcı Savunucusu',
    description: 'Sıradan bir insanın bakış açısını ve ihtiyaçlarını savunur',
    role:
      'Your role: THE USER ADVOCATE. Represent the perspective of an ordinary person affected by the question. Focus on everyday impact, hidden costs, ease of use and what people actually experience, not what experts assume.',
  },
];

const THEMES = [
  { id: 'system', icon: 'monitor', label: 'Sistem' },
  { id: 'light', icon: 'sun', label: 'Açık' },
  { id: 'dark', icon: 'moon', label: 'Koyu' },
];

const TABS = [
  { id: 'general', label: 'Genel' },
  { id: 'members', label: 'Üyeler' },
  { id: 'chairman', label: 'Başkan' },
  { id: 'discussion', label: 'Tartışma ve bağlam' },
  { id: 'advanced', label: 'Gelişmiş' },
];

function uniqueName(name, members) {
  const taken = new Set(members.map((m) => m.name.trim().toLocaleLowerCase('tr')));
  if (!taken.has(name.toLocaleLowerCase('tr'))) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`.toLocaleLowerCase('tr'))) n += 1;
  return `${name} ${n}`;
}

function freeColor(members, maxColors) {
  const used = new Set(members.map((m) => m.color));
  for (let c = 1; c <= maxColors; c += 1) if (!used.has(c)) return c;
  return null;
}

/** Field-level problems the user can fix before saving. */
function validate(data, limits) {
  const errors = {};
  if (!data) return errors;
  const seen = new Map();
  data.members.forEach((m, i) => {
    const e = {};
    const key = m.name.trim().toLocaleLowerCase('tr');
    if (!m.name.trim()) e.name = 'Ad gerekli';
    else if (seen.has(key)) e.name = 'Bu ad başka bir üyede de var';
    seen.set(key, i);
    if (!m.model.trim()) e.model = 'Model gerekli';
    if (!m.role.trim()) e.role = 'Rol talimatı gerekli';
    if (Object.keys(e).length) errors[`member-${i}`] = e;
  });
  const c = data.chairman;
  const ce = {};
  if (!c.name.trim()) ce.name = 'Ad gerekli';
  else if (seen.has(c.name.trim().toLocaleLowerCase('tr'))) ce.name = 'Bir üyeyle aynı ad olamaz';
  if (!c.model.trim()) ce.model = 'Model gerekli';
  if (!c.instructions.trim()) ce.instructions = 'Talimat gerekli';
  if (Object.keys(ce).length) errors.chairman = ce;
  if (!data.preamble.trim()) errors.preamble = 'Gerekli';
  if (!data.judge_instructions.trim()) errors.judge = 'Gerekli';
  if (data.members.length < limits.min_members) errors.count = `En az ${limits.min_members} üye gerekli`;
  return errors;
}

function Field({ label, hint, error, children }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">
        {label}
        {error && <span className="field-error">{error}</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function MemberCard({ member, index, expanded, onToggle, onChange, onRemove, canRemove, errors, modelListId }) {
  const hasErrors = Boolean(errors);
  return (
    <div className={`member-card ${expanded ? 'expanded' : ''} ${hasErrors ? 'invalid' : ''}`}>
      <div className="member-card-head">
        <button type="button" className="member-card-toggle" onClick={onToggle} aria-expanded={expanded}>
          <Icon name="chevron" size={16} className="member-card-chevron" />
          <span className="avatar" style={{ '--member-color': colorVar(member.color) }}>
            {memberInitial({ name: member.name || '?' })}
          </span>
          <span className="member-card-title">
            <span className="member-card-name">{member.name || `Üye ${index + 1}`}</span>
            <span className="member-card-desc">{member.description || 'Açıklama yok'}</span>
          </span>
          <span className="model-chip" title={member.model}>{member.model || 'model?'}</span>
        </button>
        <button
          type="button"
          className="icon-btn danger"
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? 'Üyeyi çıkar' : 'Daha az üye olamaz'}
          aria-label="Üyeyi çıkar"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      {expanded && (
        <div className="member-card-body">
          <div className="field-row">
            <Field label="Ad" error={errors?.name}>
              <input value={member.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} />
            </Field>
            <Field label="Model" error={errors?.model}>
              <input
                value={member.model}
                maxLength={100}
                list={modelListId}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Kısa açıklama" hint="Arayüzde ve Başkan'ın gördüğü üye listesinde kullanılır.">
            <input
              value={member.description}
              maxLength={160}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>
          <Field
            label="Rol talimatı"
            error={errors?.role}
            hint="Bu üyeye gönderilen talimat. Türkçe ya da İngilizce yazabilirsiniz; üye her zaman kullanıcının dilinde cevap verir."
          >
            <textarea rows={6} value={member.role} onChange={(e) => onChange({ role: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

export default function SettingsModal({
  onClose,
  onSaved,
  theme,
  onThemeChange,
  onChangeConnection,
  showWelcome,
  onShowWelcomeChange,
  initialTab = 'general',
}) {
  const [data, setData] = useState(null);
  const [original, setOriginal] = useState(null);
  const [meta, setMeta] = useState(null); // defaults, suggestions, limits
  const [tab, setTab] = useState(initialTab);
  const [expanded, setExpanded] = useState(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((res) => {
        if (cancelled) return;
        setData(res.settings);
        setOriginal(res.settings);
        setMeta({ defaults: res.defaults, suggestions: res.model_suggestions, limits: res.limits });
      })
      .catch((e) => !cancelled && setError(`Ayarlar yüklenemedi: ${e.message}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(original), [data, original]);
  const errors = useMemo(() => (meta ? validate(data, meta.limits) : {}), [data, meta]);
  const hasErrors = Object.keys(errors).length > 0;

  const requestClose = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler kaybolacak. Kapatılsın mı?')) return;
    onClose();
  };

  // Escape closes the dialog
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const update = (patch) => setData((d) => ({ ...d, ...patch }));
  const updateMember = (index, patch) =>
    setData((d) => ({ ...d, members: d.members.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));
  const updateChairman = (patch) => setData((d) => ({ ...d, chairman: { ...d.chairman, ...patch } }));

  const addMember = (template) => {
    const base = template || { name: 'Yeni Üye', description: '', role: '' };
    const member = {
      id: '',
      name: uniqueName(base.name, data.members),
      description: base.description,
      model: data.members[0]?.model || meta.suggestions[0] || '',
      role: base.role,
      color: freeColor(data.members, meta.limits.colors),
    };
    setData((d) => ({ ...d, members: [...d.members, member] }));
    setExpanded(data.members.length);
    setTemplatesOpen(false);
  };

  const removeMember = (index) => {
    const name = data.members[index].name || `Üye ${index + 1}`;
    if (!window.confirm(`${name} konseyden çıkarılsın mı?`)) return;
    setData((d) => ({ ...d, members: d.members.filter((_, i) => i !== index) }));
    setExpanded(-1);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveSettings(data);
      setData(res.settings);
      setOriginal(res.settings);
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    if (!window.confirm('Tüm üyeler, roller ve talimatlar varsayılana dönsün mü? (Kaydet ile uygulanır.)')) return;
    setData(JSON.parse(JSON.stringify(meta.defaults)));
    setExpanded(0);
  };

  const members = data?.members || [];
  const calls = data ? members.length * (2 + data.debate_rounds) + 1 : 0;
  const canAdd = meta && members.length < meta.limits.max_members;
  const modelListId = 'model-suggestions';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header">
          <div>
            <h2 id="settings-title">Ayarlar</h2>
            <p className="modal-sub">Görünüm, bağlantı ve konseyin nasıl çalıştığı.</p>
          </div>
          <button className="icon-btn" onClick={requestClose} aria-label="Kapat">
            <Icon name="x" />
          </button>
        </header>

        <nav className="modal-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`modal-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'members' && data && <span className="tab-count">{members.length}</span>}
              {((t.id === 'members' && Object.keys(errors).some((k) => k.startsWith('member') || k === 'count')) ||
                (t.id === 'chairman' && errors.chairman) ||
                (t.id === 'advanced' && (errors.preamble || errors.judge))) && <span className="tab-dot" />}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {!data && !error && (
            <div className="modal-loading">
              <span className="spinner" /> Yükleniyor…
            </div>
          )}

          {data && meta && (
            <>
              <datalist id={modelListId}>
                {meta.suggestions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>

              {tab === 'general' && (
                <div className="tab-panel">
                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">Tema</span>
                      <span className="setting-desc">
                        Sistem, bilgisayarınızın açık/koyu ayarını izler. Değişiklik hemen uygulanır.
                      </span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Tema">
                      {THEMES.map((t) => (
                        <button
                          key={t.id}
                          role="radio"
                          aria-checked={theme === t.id}
                          className={`segment segment-icon ${theme === t.id ? 'active' : ''}`}
                          onClick={() => onThemeChange(t.id)}
                        >
                          <Icon name={t.icon} size={15} />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="setting-block setting-toggle">
                    <span className="setting-head">
                      <span className="setting-title">Açılışta karşılama ekranı</span>
                      <span className="setting-desc">Uygulama her açıldığında önce karşılama sayfası gösterilir.</span>
                    </span>
                    <input
                      type="checkbox"
                      className="switch"
                      checked={showWelcome}
                      onChange={(e) => onShowWelcomeChange(e.target.checked)}
                    />
                  </label>

                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">API bağlantısı</span>
                      <span className="setting-desc">
                        Sağlayıcı, API anahtarı, model ve token limitleri. Anahtar bu bilgisayarda şifreli saklanır.
                      </span>
                    </div>
                    <ConnectionCard onChange={onChangeConnection} />
                  </div>
                </div>
              )}

              {tab === 'members' && (
                <div className="tab-panel">
                  <p className="panel-intro">
                    Her üye soruyu kendi rolüyle cevaplar, diğerlerinin cevaplarını tartışır ve anonim olarak değerlendirir.
                    {` ${meta.limits.min_members}–${meta.limits.max_members} üye olabilir.`}
                  </p>
                  {errors.count && <div className="form-error">{errors.count}</div>}
                  <div className="member-list">
                    {members.map((m, i) => (
                      <MemberCard
                        key={`${m.id || 'new'}-${i}`}
                        member={m}
                        index={i}
                        expanded={expanded === i}
                        onToggle={() => setExpanded(expanded === i ? -1 : i)}
                        onChange={(patch) => updateMember(i, patch)}
                        onRemove={() => removeMember(i)}
                        canRemove={members.length > meta.limits.min_members}
                        errors={errors[`member-${i}`]}
                        modelListId={modelListId}
                      />
                    ))}
                  </div>
                  <div className="add-member">
                    <button className="btn btn-ghost" onClick={() => addMember(null)} disabled={!canAdd}>
                      <Icon name="plus" size={16} /> Boş üye ekle
                    </button>
                    <div className="template-picker">
                      <button
                        className="btn btn-ghost"
                        onClick={() => setTemplatesOpen((o) => !o)}
                        disabled={!canAdd}
                        aria-expanded={templatesOpen}
                      >
                        <Icon name="sparkle" size={16} /> Şablondan ekle
                      </button>
                      {templatesOpen && (
                        <div className="template-menu" role="menu">
                          {TEMPLATES.map((t) => (
                            <button key={t.name} role="menuitem" className="template-item" onClick={() => addMember(t)}>
                              <span className="template-name">{t.name}</span>
                              <span className="template-desc">{t.description}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!canAdd && <span className="field-hint">En fazla {meta.limits.max_members} üye.</span>}
                  </div>
                </div>
              )}

              {tab === 'chairman' && (
                <div className="tab-panel">
                  <p className="panel-intro">
                    Başkan tüm cevapları, tartışmayı ve değerlendirmeleri okuyup son cevabı yazar.
                  </p>
                  <div className="field-row">
                    <Field label="Ad" error={errors.chairman?.name}>
                      <input
                        value={data.chairman.name}
                        maxLength={40}
                        onChange={(e) => updateChairman({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="Model" error={errors.chairman?.model}>
                      <input
                        value={data.chairman.model}
                        maxLength={100}
                        list={modelListId}
                        onChange={(e) => updateChairman({ model: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Kısa açıklama">
                    <input
                      value={data.chairman.description}
                      maxLength={160}
                      onChange={(e) => updateChairman({ description: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Başkan talimatı"
                    error={errors.chairman?.instructions}
                    hint="Üyelerin adları ve açıklamaları bu talimatın başına otomatik eklenir."
                  >
                    <textarea
                      rows={8}
                      value={data.chairman.instructions}
                      onChange={(e) => updateChairman({ instructions: e.target.value })}
                    />
                  </Field>
                </div>
              )}

              {tab === 'discussion' && (
                <div className="tab-panel">
                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">Tartışma turu</span>
                      <span className="setting-desc">
                        İlk cevaplardan sonra üyeler birbirlerinin cevaplarını okuyup isimleriyle birbirine cevap verir.
                        Başkan bu tartışmayı da görür. 0 tartışmayı kapatır.
                      </span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label="Tartışma turu">
                      {Array.from({ length: meta.limits.max_debate_rounds + 1 }, (_, n) => (
                        <button
                          key={n}
                          role="radio"
                          aria-checked={data.debate_rounds === n}
                          className={`segment ${data.debate_rounds === n ? 'active' : ''}`}
                          onClick={() => update({ debate_rounds: n })}
                        >
                          {n === 0 ? 'Kapalı' : `${n} tur`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">Sohbet bağlamı</span>
                      <span className="setting-desc">
                        Takip sorularında konseye gönderilen önceki soru-cevap sayısı. Fazlası daha çok token harcar.
                      </span>
                    </div>
                    <div className="range-row">
                      <input
                        type="range"
                        min={0}
                        max={meta.limits.max_history_turns}
                        value={data.history_turns}
                        onChange={(e) => update({ history_turns: Number(e.target.value) })}
                        aria-label="Bağlam turu sayısı"
                      />
                      <span className="range-value">
                        {data.history_turns === 0 ? 'Kapalı' : `Son ${data.history_turns}`}
                      </span>
                    </div>
                  </div>

                  <div className="estimate">
                    <Icon name="alert" size={16} />
                    <span>
                      Bu ayarlarla her soru yaklaşık <strong>{calls} API çağrısı</strong> yapar ({members.length} cevap
                      {data.debate_rounds > 0 && ` + ${members.length * data.debate_rounds} tartışma mesajı`} +{' '}
                      {members.length} değerlendirme + 1 Başkan; ilk soruda +1 başlık).
                    </span>
                  </div>
                </div>
              )}

              {tab === 'advanced' && (
                <div className="tab-panel">
                  <Field
                    label="Ortak üye talimatı"
                    error={errors.preamble}
                    hint="İlk cevap aşamasında her üyenin rol talimatının başına eklenir."
                  >
                    <textarea rows={5} value={data.preamble} onChange={(e) => update({ preamble: e.target.value })} />
                  </Field>
                  <Field
                    label="Hakem talimatı"
                    error={errors.judge}
                    hint="Çapraz değerlendirmede kullanılır. “Response A” etiket kuralı ve sıralama biçimi otomatik eklenir."
                  >
                    <textarea
                      rows={6}
                      value={data.judge_instructions}
                      onChange={(e) => update({ judge_instructions: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </>
          )}
        </div>

        {error && <div className="form-error modal-error">{error}</div>}

        <footer className="modal-footer">
          <button className="btn btn-ghost" onClick={resetToDefaults} disabled={!meta}>
            Varsayılanlara dön
          </button>
          <div className="modal-footer-right">
            {dirty && <span className="unsaved">Kaydedilmemiş değişiklikler</span>}
            <button className="btn btn-ghost" onClick={requestClose}>
              İptal
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || hasErrors || saving}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
