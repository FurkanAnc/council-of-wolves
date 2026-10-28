import { useState } from 'react';
import Icon from './Icon';
import { copyToClipboard } from '../utils/format';

export default function CopyButton({ text, label = 'Kopyala' }) {
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
      title={copied ? 'Kopyalandı' : label}
      aria-label={copied ? 'Kopyalandı' : label}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
    </button>
  );
}
