import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { ConnectionCard } from './ConnectionStatus';
import { api } from '../api';
import { colorVar, memberInitial } from '../utils/labels';
import { t, lower, LANGUAGES } from '../i18n';
import './SettingsModal.css';

// Role instructions for the ready-made member templates (names and
// descriptions come from t('settings.templates'), in the same order)
const TEMPLATE_ROLES = [
  'Your role: THE ETHICIST. Answer the question, but examine its ethical, social and legal implications: who could be harmed or helped, what values are in tension, and what a responsible choice looks like. Be concrete, not preachy.',
  'Your role: THE CREATIVE. Propose unconventional, imaginative approaches the others are unlikely to suggest. Reframe the problem, combine ideas from other fields, and offer at least one bold option, while noting how practical each idea is.',
  'Your role: THE ANALYST. Ground your answer in numbers, data and measurable evidence. Give estimates with ranges, explain the assumptions behind them, and say what data would change your conclusion.',
  'Your role: THE TEACHER. Explain the topic as simply and clearly as possible, as if to a curious beginner. Use analogies and short examples, define jargon, and build from the basics to the answer.',
  'Your role: THE USER ADVOCATE. Represent the perspective of an ordinary person affected by the question. Focus on everyday impact, hidden costs, ease of use and what people actually experience, not what experts assume.',
];

const THEMES = [
  { id: 'system', icon: 'monitor' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
];

const TABS = ['general', 'members', 'chairman', 'discussion', 'advanced'];

function templates() {
  return t('settings.templates').map((tpl, i) => ({ ...tpl, role: TEMPLATE_ROLES[i] }));
}

function uniqueName(name, members) {
  const taken = new Set(members.map((m) => lower(m.name.trim())));
  if (!taken.has(lower(name))) return name;
  let n = 2;
  while (taken.has(lower(`${name} ${n}`))) n += 1;
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
    const key = lower(m.name.trim());
    if (!m.name.trim()) e.name = t('validation.nameRequired');
    else if (seen.has(key)) e.name = t('validation.nameTaken');
    seen.set(key, i);
    if (!m.model.trim()) e.model = t('validation.modelRequired');
    if (!m.role.trim()) e.role = t('validation.roleRequired');
    if (Object.keys(e).length) errors[`member-${i}`] = e;
  });
  const c = data.chairman;
  const ce = {};
  if (!c.name.trim()) ce.name = t('validation.nameRequired');
  else if (seen.has(lower(c.name.trim()))) ce.name = t('validation.chairmanName');
  if (!c.model.trim()) ce.model = t('validation.modelRequired');
  if (!c.instructions.trim()) ce.instructions = t('validation.instructionsRequired');
  if (Object.keys(ce).length) errors.chairman = ce;
  if (!data.preamble.trim()) errors.preamble = t('validation.required');
  if (!data.judge_instructions.trim()) errors.judge = t('validation.required');
  if (data.members.length < limits.min_members) errors.count = t('validation.minMembers', { n: limits.min_members });
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
            <span className="member-card-name">{member.name || t('settings.memberN', { n: index + 1 })}</span>
            <span className="member-card-desc">{member.description || t('settings.noDescription')}</span>
          </span>
          <span className="model-chip" title={member.model}>{member.model || 'model?'}</span>
        </button>
        <button
          type="button"
          className="icon-btn danger"
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? t('settings.removeMember') : t('settings.cannotRemove')}
          aria-label={t('settings.removeMember')}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      {expanded && (
        <div className="member-card-body">
          <div className="field-row">
            <Field label={t('settings.name')} error={errors?.name}>
              <input value={member.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} />
            </Field>
            <Field label={t('settings.model')} error={errors?.model}>
              <input
                value={member.model}
                maxLength={100}
                list={modelListId}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </Field>
          </div>
          <Field label={t('settings.description')} hint={t('settings.descriptionHint')}>
            <input
              value={member.description}
              maxLength={160}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </Field>
          <Field label={t('settings.role')} error={errors?.role} hint={t('settings.roleHint')}>
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
  lang,
  onLanguageChange,
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

  // Loaded again when the language changes: default member names follow it
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
      .catch((e) => !cancelled && setError(t('settings.loadFailed', { error: e.message })));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const dirty = useMemo(() => JSON.stringify(data) !== JSON.stringify(original), [data, original]);
  const errors = useMemo(() => (meta ? validate(data, meta.limits) : {}), [data, meta, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasErrors = Object.keys(errors).length > 0;

  const requestClose = () => {
    if (dirty && !window.confirm(t('settings.discardConfirm'))) return;
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
    const base = template || { name: t('settings.newMember'), description: '', role: '' };
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
    const name = data.members[index].name || t('settings.memberN', { n: index + 1 });
    if (!window.confirm(t('settings.removeConfirm', { name }))) return;
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
    if (!window.confirm(t('settings.resetConfirm'))) return;
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
            <h2 id="settings-title">{t('settings.title')}</h2>
            <p className="modal-sub">{t('settings.subtitle')}</p>
          </div>
          <button className="icon-btn" onClick={requestClose} aria-label={t('common.close')}>
            <Icon name="x" />
          </button>
        </header>

        <nav className="modal-tabs" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`modal-tab ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`settings.tab.${id}`)}
              {id === 'members' && data && <span className="tab-count">{members.length}</span>}
              {((id === 'members' && Object.keys(errors).some((k) => k.startsWith('member') || k === 'count')) ||
                (id === 'chairman' && errors.chairman) ||
                (id === 'advanced' && (errors.preamble || errors.judge))) && <span className="tab-dot" />}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {!data && !error && (
            <div className="modal-loading">
              <span className="spinner" /> {t('common.loading')}
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
                      <span className="setting-title">{t('settings.language')}</span>
                      <span className="setting-desc">{t('settings.languageDesc')}</span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label={t('settings.language')}>
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.id}
                          role="radio"
                          aria-checked={lang === l.id}
                          className={`segment ${lang === l.id ? 'active' : ''}`}
                          onClick={() => onLanguageChange(l.id)}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">{t('settings.theme')}</span>
                      <span className="setting-desc">{t('settings.themeDesc')}</span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label={t('settings.theme')}>
                      {THEMES.map((th) => (
                        <button
                          key={th.id}
                          role="radio"
                          aria-checked={theme === th.id}
                          className={`segment segment-icon ${theme === th.id ? 'active' : ''}`}
                          onClick={() => onThemeChange(th.id)}
                        >
                          <Icon name={th.icon} size={15} />
                          {t(`theme.${th.id}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="setting-block setting-toggle">
                    <span className="setting-head">
                      <span className="setting-title">{t('settings.welcome')}</span>
                      <span className="setting-desc">{t('settings.welcomeDesc')}</span>
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
                      <span className="setting-title">{t('settings.connection')}</span>
                      <span className="setting-desc">{t('settings.connectionDesc')}</span>
                    </div>
                    <ConnectionCard onChange={onChangeConnection} />
                  </div>
                </div>
              )}

              {tab === 'members' && (
                <div className="tab-panel">
                  <p className="panel-intro">
                    {t('settings.membersIntro', { min: meta.limits.min_members, max: meta.limits.max_members })}
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
                      <Icon name="plus" size={16} /> {t('settings.addBlank')}
                    </button>
                    <div className="template-picker">
                      <button
                        className="btn btn-ghost"
                        onClick={() => setTemplatesOpen((o) => !o)}
                        disabled={!canAdd}
                        aria-expanded={templatesOpen}
                      >
                        <Icon name="sparkle" size={16} /> {t('settings.addTemplate')}
                      </button>
                      {templatesOpen && (
                        <div className="template-menu" role="menu">
                          {templates().map((tpl) => (
                            <button key={tpl.name} role="menuitem" className="template-item" onClick={() => addMember(tpl)}>
                              <span className="template-name">{tpl.name}</span>
                              <span className="template-desc">{tpl.description}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!canAdd && <span className="field-hint">{t('settings.maxMembers', { n: meta.limits.max_members })}</span>}
                  </div>
                </div>
              )}

              {tab === 'chairman' && (
                <div className="tab-panel">
                  <p className="panel-intro">{t('settings.chairmanIntro')}</p>
                  <div className="field-row">
                    <Field label={t('settings.name')} error={errors.chairman?.name}>
                      <input
                        value={data.chairman.name}
                        maxLength={40}
                        onChange={(e) => updateChairman({ name: e.target.value })}
                      />
                    </Field>
                    <Field label={t('settings.model')} error={errors.chairman?.model}>
                      <input
                        value={data.chairman.model}
                        maxLength={100}
                        list={modelListId}
                        onChange={(e) => updateChairman({ model: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label={t('settings.description')}>
                    <input
                      value={data.chairman.description}
                      maxLength={160}
                      onChange={(e) => updateChairman({ description: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={t('settings.chairmanInstructions')}
                    error={errors.chairman?.instructions}
                    hint={t('settings.chairmanInstructionsHint')}
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
                      <span className="setting-title">{t('settings.debateRounds')}</span>
                      <span className="setting-desc">{t('settings.debateRoundsDesc')}</span>
                    </div>
                    <div className="segmented" role="radiogroup" aria-label={t('settings.debateRounds')}>
                      {Array.from({ length: meta.limits.max_debate_rounds + 1 }, (_, n) => (
                        <button
                          key={n}
                          role="radio"
                          aria-checked={data.debate_rounds === n}
                          className={`segment ${data.debate_rounds === n ? 'active' : ''}`}
                          onClick={() => update({ debate_rounds: n })}
                        >
                          {n === 0 ? t('common.off') : t('settings.nRounds', { n })}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="setting-block">
                    <div className="setting-head">
                      <span className="setting-title">{t('settings.context')}</span>
                      <span className="setting-desc">{t('settings.contextDesc')}</span>
                    </div>
                    <div className="range-row">
                      <input
                        type="range"
                        min={0}
                        max={meta.limits.max_history_turns}
                        value={data.history_turns}
                        onChange={(e) => update({ history_turns: Number(e.target.value) })}
                        aria-label={t('settings.contextLabel')}
                      />
                      <span className="range-value">
                        {data.history_turns === 0 ? t('common.off') : t('settings.lastN', { n: data.history_turns })}
                      </span>
                    </div>
                  </div>

                  <div className="estimate">
                    <Icon name="alert" size={16} />
                    <span>
                      {t(data.debate_rounds > 0 ? 'settings.estimateDebate' : 'settings.estimate', {
                        calls,
                        n: members.length,
                        debate: members.length * data.debate_rounds,
                      })}
                    </span>
                  </div>
                </div>
              )}

              {tab === 'advanced' && (
                <div className="tab-panel">
                  <Field label={t('settings.preamble')} error={errors.preamble} hint={t('settings.preambleHint')}>
                    <textarea rows={5} value={data.preamble} onChange={(e) => update({ preamble: e.target.value })} />
                  </Field>
                  <Field label={t('settings.judge')} error={errors.judge} hint={t('settings.judgeHint')}>
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
            {t('settings.reset')}
          </button>
          <div className="modal-footer-right">
            {dirty && <span className="unsaved">{t('settings.unsaved')}</span>}
            <button className="btn btn-ghost" onClick={requestClose}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || hasErrors || saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
