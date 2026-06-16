const plannedCapabilities = [
  "Live transcript chunks",
  "Real-time AI cue cards",
  "Conversation summary",
  "Conversation history",
];

export default function App() {
  return (
    <main className="phone-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Conversation Intelligence</p>
          <h1>CueFlow</h1>
        </div>
        <span className="status-pill">Phase 1</span>
      </header>

      <section className="hero-panel">
        <h2>Real-time conversation intelligence</h2>
        <p>
          CueFlow will receive live transcript chunks, detect useful context, and generate lightweight AI cue cards during a conversation.
        </p>
      </section>

      <section className="stack">
        {plannedCapabilities.map((item) => (
          <article className="card" key={item}>
            <h3>{item}</h3>
            <p>Foundation ready for the upcoming MVP phase.</p>
          </article>
        ))}
      </section>
    </main>
  );
}

