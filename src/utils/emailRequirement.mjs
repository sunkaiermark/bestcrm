import { formatPlainEmailForReading } from './emailPresentation.mjs';

// Derive an editable requirement draft; never mutate the archived message.
export function organizeEmailRequirement(body, fallback = '') {
  const lines = String(body || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').split('\n');
  const result = [];
  for (const raw of lines) {
    const line = raw.trim();
    const hasContent = result.some(value => value.trim());
    if (hasContent && /^(?:N\s*O\s*T\s*I\s*C\s*E\s*[-:：]|confidentiality\s+(?:notice|statement)|this\s+(?:e-?mail|message)\s+(?:and\s+(?:any\s+)?attachments?\s+)?(?:is\s+(?:confidential|intended)|contains\s+confidential)|免责声明[：:]?|保密声明[：:]?)/i.test(line)) break;
    if (hasContent && /^(?:best\s+regards?|kind\s+regards?|regards|sincerely|yours\s+(?:sincerely|faithfully)|此致|敬上)[,，.!！。]?$/i.test(line)) break;
    if (/^(?:(?:hi|hello|dear)\s+[^.!?。！？]{1,80}[,，:]|(?:您好|你好)[，,!！：:]?)$/i.test(line)) continue;
    if (/^(?:thanks?(?:\s+(?:you|for\s+your\s+(?:support|help|assistance)))?|thank\s+you(?:\s+for\s+your\s+(?:support|help|assistance))?|谢谢(?:支持|配合)?)[,，.!！。]?$/i.test(line)) continue;
    result.push(line);
  }
  const organized = result.join('\n').trim().split(/\n[\t ]*\n+/).map(block =>
    block.split('\n').some(line => /^[^:：]{1,40}[:：]\s*\S/.test(line))
      ? block : formatPlainEmailForReading(block)
  ).join('\n\n').trim();
  return organized || String(fallback || '').trim() || String(body || '').trim();
}
