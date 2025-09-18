import { useState } from 'react';

export default function AtexChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  if (!open) return null;

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessages = [...messages, { role: 'user', content: input }];
    setMessages(newMessages);
    setInput('');

    try {
      const res = await fetch('/api/openai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      setMessages([...newMessages, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages([...newMessages, { role: 'assistant', content: 'Erreur de connexion à l’IA.' }]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end">
      <div className="w-full sm:w-96 bg-white h-full shadow-xl flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">Assistant IA</h2>
          <button onClick={onClose} className="text-gray-500">✖</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl max-w-[80%] ${
                m.role === 'user' ? 'bg-brand-100 ml-auto' : 'bg-gray-100'
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>
        <form onSubmit={sendMessage} className="p-4 border-t flex gap-2">
          <input
            className="input flex-1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écrire un message…"
          />
          <button className="btn btn-primary">Envoyer</button>
        </form>
      </div>
    </div>
  );
}
