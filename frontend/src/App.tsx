/**
 * SnowGram Main Application - Minimal Version
 * =========================
 * Temporary placeholder until Phase 8 frontend implementation
 */

'use client';

import React from 'react';

const App: React.FC = () => {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>❄️ SnowGram</h1>
        <p style={{ fontSize: '1.5rem', opacity: 0.9 }}>
          Cortex-Powered Diagram Generator
        </p>
        <p style={{ marginTop: '2rem', opacity: 0.7 }}>
          Backend deployed successfully!
        </p>
        <p style={{ opacity: 0.6, fontSize: '0.9rem', marginTop: '1rem' }}>
          Frontend components coming in Phase 8...
        </p>
      </div>
    </div>
  );
};

export default App;
