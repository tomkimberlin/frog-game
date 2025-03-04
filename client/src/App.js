import React, { useState } from 'react';
import Game from './components/Game';
import './App.css';

function App() {
  const [playerName, setPlayerName] = useState('');
  const [gameStarted, setGameStarted] = useState(false);

  const handleStartGame = (e) => {
    e.preventDefault();
    if (playerName.trim()) {
      setGameStarted(true);
    }
  };

  return (
    <div className="App">
      {!gameStarted ? (
        <div className="start-screen">
          <h1>Frog Game</h1>
          <form onSubmit={handleStartGame}>
            <input
              type="text"
              placeholder="Enter your frog's name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              required
            />
            <button type="submit">Start Game</button>
          </form>
        </div>
      ) : (
        <div className="game-screen">
          <Game playerName={playerName} />
        </div>
      )}
    </div>
  );
}

export default App; 