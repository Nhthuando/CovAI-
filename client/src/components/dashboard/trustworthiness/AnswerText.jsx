export default function AnswerText({ children, className = '' }) {
  const parts = String(children ?? '').split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => part.startsWith('**') && part.endsWith('**')
        ? <strong key={index}>{part.slice(2, -2)}</strong>
        : part)}
    </p>
  );
}
