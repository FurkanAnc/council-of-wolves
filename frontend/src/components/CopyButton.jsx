import { useState } from 'react';
import Icon from './Icon';
import { copyToClipboard } from '../utils/format';
import { t } from '../i18n';

export default function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (await copyToClipboard(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      className="icon-btn small"
      onClick={handleCopy}
      title={copied ? t('copy.done') : label || t('copy.copy')}
      aria-label={copied ? t('copy.done') : label || t('copy.copy')}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
    </button>
  );
}
