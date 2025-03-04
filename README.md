# Frog Game

A multiplayer web-based game inspired by Pocket Frogs, where players control frogs that can move between lily pads, catch flies, and battle other frogs using their extendable tongues.

## Features

- Real-time multiplayer gameplay
- Frog movement between lily pads
- Fly-catching mechanics
- Frog battles using extendable tongues
- Size and power progression system
- Modern web-based interface

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm run install-all
```

## Running the Game

1. Start both the client and server:
```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

## Game Controls

- Left Click: Move frog to lily pad
- Right Click: Extend tongue to catch flies or attack other frogs

## Development

- Client runs on port 3000
- Server runs on port 4000
- WebSocket connection is established automatically

## Technologies Used

- React
- Phaser.js
- Socket.IO
- Node.js
- Express 