import { useState } from 'react';
import Markdown from './Markdown';
import { MemberTabs, TruncatedBadge } from './Stage1';
import { memberColor, memberInitial, memberLabel, memberName, labelInfo } from '../utils/labels';
import './Stage2.css';

function deAnonymizeText(text, labelMapping) {
  if (!labelMapping) return text;

  let result = text;
  // Replace each "Response X" (or Turkish "Yanıt X" / "Cevap X") with the member's name
  Object.keys(labelMapping).forEach((label) => {
    const letter = label.slice(-1);
    const name = memberName(labelInfo(labelMapping, label));
    const pattern = new RegExp(`(^|[^\\p{L}])(?:Response|Yan[ıi]t|Cevap)\\s+${letter}(?![\\p{L}\\p{N}])`, 'gu');
    result = result.replace(pattern, `$1**${name}**`);
  });
  return result;
}

function AggregateRanking({ aggregateRankings }) {
  const count = aggregateRankings.length;
  return (
    <div className="aggregate">
      <div className="aggregate-head">
        <h4>Genel sıralama</h4>
        <span className="aggregate-note">Ortalama sıra, düşük olan daha iyi</span>
      </div>
      <ol className="aggregate-list">
        {aggregateRankings.map((agg, index) => {
          // Rank 1 fills the bar; the worst possible rank leaves a small stub
          const share = count > 0 ? (count + 1 - agg.average_rank) / count : 0;
          const width = `${Math.max(4, Math.min(100, share * 100))}%`;
          return (
            <li
              key={agg.member_id || index}
              className="aggregate-row"
              title={`${memberLabel(agg)}: ortalama sıra ${agg.average_rank.toFixed(2)}, ${agg.rankings_count} oy`}
            >
              <span className="aggregate-pos">{index + 1}</span>
              <span className="aggregate-name">
                <span className="avatar small" style={{ '--member-color': memberColor(agg.member_id) }}>
                  {memberInitial(agg)}
                </span>
                {memberName(agg)}
              </span>
              <span className="aggregate-track">
                <span className="aggregate-bar" style={{ width }} />
              </span>
              <span className="aggregate-value">
                {agg.average_rank.toFixed(2)}
                <span className="aggregate-votes"> · {agg.rankings_count} oy</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function Stage2({ rankings, labelToMember, labelToModel, aggregateRankings }) {
  const [activeTab, setActiveTab] = useState(0);

  if (!rankings || rankings.length === 0) {
    return null;
  }

  // Old records only have label_to_model
  const labelMapping = labelToMember || labelToModel;
  const active = rankings[Math.min(activeTab, rankings.length - 1)];

  return (
    <div className="stage2">
      {aggregateRankings && aggregateRankings.length > 0 && (
        <AggregateRanking aggregateRankings={aggregateRankings} />
      )}

      <h4 className="evaluations-title">Değerlendirmeler</h4>
      <p className="stage-description">
        Her üye tüm cevapları anonim etiketlerle (Response A, B, C…) ve tarafsız hakem olarak değerlendirdi.
        Okumayı kolaylaştırmak için etiketlerin yerine üye adları <strong>kalın</strong> yazıldı.
      </p>

      <MemberTabs items={rankings} active={activeTab} onChange={setActiveTab} label="Değerlendiren üye" />

      <div className="member-panel" role="tabpanel">
        {active.truncated && (
          <div className="panel-badges">
            <TruncatedBadge />
          </div>
        )}
        <Markdown>{deAnonymizeText(active.ranking, labelMapping)}</Markdown>

        {active.parsed_ranking && active.parsed_ranking.length > 0 && (
          <div className="parsed-ranking">
            <span className="parsed-ranking-title">Çıkarılan sıralama</span>
            <ol>
              {active.parsed_ranking.map((label, i) => {
                const info = labelInfo(labelMapping, label);
                return <li key={i}>{info ? memberName(info) : label}</li>;
              })}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
