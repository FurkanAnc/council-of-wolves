/**
 * Date grouping, Markdown export and clipboard helpers.
 */

import { memberLabel } from './labels';
import { t, locale } from '../i18n';

/** Backend timestamps are naive UTC ISO strings; parse them as UTC. */
export function parseDate(iso) {
  if (!iso) return null;
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const date = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sidebar group key for a conversation date (translated as t(`group.${key}`)). */
export function dateGroup(iso, now = new Date()) {
  const date = parseDate(iso);
  if (!date) return 'older';
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  if (days < 30) return 'month';
  return 'older';
}

export const GROUP_ORDER = ['today', 'yesterday', 'week', 'month', 'older'];

/** Short time or date label for a conversation. */
export function shortDate(iso, now = new Date()) {
  const date = parseDate(iso);
  if (!date) return '';
  if (dateGroup(iso, now) === 'today') {
    return date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? t('time.minSec', { m: minutes, s: seconds }) : t('time.sec', { s: seconds });
}

/** 15234 -> "15,2k" / "15.2k" (compact token counts) */
export function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  const value = (n / 1000).toFixed(n < 10000 ? 1 : 0);
  return `${locale() === 'tr-TR' ? value.replace('.', ',') : value}k`;
}

/** Whole conversation as a Markdown document. */
export function conversationToMarkdown(conversation) {
  const lines = [`# ${conversation.title || t('export.defaultTitle')}`, ''];
  const created = parseDate(conversation.created_at);
  if (created) {
    lines.push(`_${created.toLocaleString(locale())}_`, '');
  }

  for (const msg of conversation.messages || []) {
    if (msg.role === 'user') {
      lines.push('---', '', `## ${t('export.question')}`, '', msg.content, '');
      continue;
    }
    if (msg.error) {
      lines.push(`> ${t('export.error')}: ${msg.error}`, '');
      continue;
    }
    if (msg.stage3) {
      lines.push(`## ${t('export.answer')} (${memberLabel(msg.stage3)})`, '', msg.stage3.response, '');
    }
    if (msg.metadata?.aggregate_rankings?.length) {
      lines.push(`### ${t('stage2.overall')}`, '');
      msg.metadata.aggregate_rankings.forEach((agg, i) => {
        lines.push(`${i + 1}. ${memberLabel(agg)} (${t('export.average')} ${agg.average_rank.toFixed(2)})`);
      });
      lines.push('');
    }
    if (msg.debate?.length) {
      lines.push(`### ${t('debate.title')}`, '');
      msg.debate.forEach((round, r) => {
        lines.push(`**${t('debate.round', { n: r + 1 })}**`, '');
        for (const m of round) lines.push(`- **${m.member_name}:** ${m.message.replace(/\n+/g, ' ')}`);
        lines.push('');
      });
    }
    if (msg.stage1?.length) {
      lines.push(`### ${t('stage1.title')}`, '');
      for (const resp of msg.stage1) {
        lines.push(`#### ${memberLabel(resp)}`, '', resp.response, '');
      }
    }
  }
  return lines.join('\n');
}

export function downloadText(filename, text, type = 'text/markdown') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Safe file name from a conversation title. */
export function fileNameFor(title) {
  const base = (title || t('export.fileName'))
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || t('export.fileName')}.md`;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
