const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Game state
const gameState = {
  players: new Map(),
  flies: [],
  lilyPads: [],
  worldSize: {
    width: 2400,  // 3x viewport width
    height: 1800  // 3x viewport height
  }
};

// Generate initial lily pads
function generateLilyPads() {
  const pads = [];
  const padRadius = 80; // Increased size for better spacing
  const minDistance = padRadius * 3; // Reduced minimum distance for better connectivity
  const maxDistance = padRadius * 4; // Maximum distance between pads
  const padding = padRadius * 2; // Padding from edges
  
  // Create center lily pad for initial spawn
  const centerPad = {
    id: 'pad-center',
    x: gameState.worldSize.width / 2,
    y: gameState.worldSize.height / 2,
    isSpawnPoint: true
  };
  pads.push(centerPad);
  
  // Create a grid-based distribution with randomization
  const gridSize = 250; // Reduced grid size for better pad density
  const cols = Math.floor(gameState.worldSize.width / gridSize);
  const rows = Math.floor(gameState.worldSize.height / gridSize);
  
  // Try to place lily pads in each grid cell with some randomness
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Skip the center grid cell as we already have the spawn point there
      const isCenterCell = Math.floor(cols/2) === col && Math.floor(rows/2) === row;
      if (isCenterCell) continue;

      // 80% chance to place a pad in each cell for better connectivity
      if (Math.random() < 0.8) {
        // Calculate base position within the grid cell
        const baseX = col * gridSize + padding;
        const baseY = row * gridSize + padding;
        
        // Add randomness within the grid cell
        const randX = baseX + Math.random() * (gridSize - padding * 2);
        const randY = baseY + Math.random() * (gridSize - padding * 2);
        
        // Check distance from all other pads
        let validPosition = true;
        let hasNearbyPad = false;
        
        for (const pad of pads) {
          const distance = Math.sqrt(Math.pow(randX - pad.x, 2) + Math.pow(randY - pad.y, 2));
          if (distance < minDistance) {
            validPosition = false;
            break;
          }
          // Check if there's at least one pad within jumping distance
          if (distance <= maxDistance) {
            hasNearbyPad = true;
          }
        }
        
        // Only place pad if it's valid and has at least one nearby pad (except for first few pads)
        if (validPosition && (pads.length < 5 || hasNearbyPad)) {
          pads.push({
            id: `pad-${row}-${col}`,
            x: randX,
            y: randY,
            isSpawnPoint: false
          });
        }
      }
    }
  }

  // Add connecting pads to ensure reachability
  const extraPads = 30;
  for (let i = 0; i < extraPads; i++) {
    let attempts = 0;
    let validPosition = false;
    let x, y;

    while (!validPosition && attempts < 50) {
      // Pick a random existing pad
      const sourcePad = pads[Math.floor(Math.random() * pads.length)];
      const angle = Math.random() * Math.PI * 2;
      const distance = minDistance + Math.random() * (maxDistance - minDistance);
      
      x = sourcePad.x + Math.cos(angle) * distance;
      y = sourcePad.y + Math.sin(angle) * distance;
      
      // Ensure within world bounds
      if (x < padding || x > gameState.worldSize.width - padding ||
          y < padding || y > gameState.worldSize.height - padding) {
        attempts++;
        continue;
      }
      
      validPosition = true;
      for (const pad of pads) {
        const dist = Math.sqrt(Math.pow(x - pad.x, 2) + Math.pow(y - pad.y, 2));
        if (dist < minDistance) {
          validPosition = false;
          break;
        }
      }
      attempts++;
    }

    if (validPosition) {
      pads.push({
        id: `pad-extra-${i}`,
        x: x,
        y: y,
        isSpawnPoint: false
      });
    }
  }

  return pads;
}

// Generate a new fly with world bounds
function generateFly() {
  // Generate initial position
  const x = Math.random() * gameState.worldSize.width;
  const y = Math.random() * gameState.worldSize.height;
  
  // Always generate target far away from spawn position
  const angle = Math.random() * Math.PI * 2;
  const distance = 300; // Fixed distance for predictable behavior
  
  const targetX = x + Math.cos(angle) * distance;
  const targetY = y + Math.sin(angle) * distance;
  
  // Ensure target is within bounds
  const boundedTargetX = Math.max(0, Math.min(gameState.worldSize.width, targetX));
  const boundedTargetY = Math.max(0, Math.min(gameState.worldSize.height, targetY));
  
  return {
    id: `fly-${Date.now()}-${Math.random()}`, // Ensure unique IDs
    x: x,
    y: y,
    targetX: boundedTargetX,
    targetY: boundedTargetY,
    speed: 2 + Math.random() * 2 // Random speed between 2 and 4
  };
}

// Initialize game state
gameState.lilyPads = generateLilyPads();
// Clear any existing flies
gameState.flies = [];
// Generate 10 initial flies
for (let i = 0; i < 10; i++) {
  gameState.flies.push(generateFly());
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Handle new player
  socket.on('newPlayer', (playerName) => {
    // Find spawn pad (center pad)
    const spawnPad = gameState.lilyPads.find(pad => pad.isSpawnPoint);
    
    const player = {
      id: socket.id,
      name: playerName,
      x: spawnPad.x,
      y: spawnPad.y,
      size: 1,
      health: 100
    };
    gameState.players.set(socket.id, player);
    
    // Send complete game state to new player
    socket.emit('gameState', {
      players: Array.from(gameState.players.values()),
      flies: gameState.flies,
      lilyPads: gameState.lilyPads,
      worldSize: gameState.worldSize
    });

    // Broadcast new player to all other players
    socket.broadcast.emit('playerJoined', player);
  });

  // Handle player movement
  socket.on('moveToLilyPad', (padId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const targetPad = gameState.lilyPads.find(pad => pad.id === padId);
    if (!targetPad) return;

    // Move player to the target lily pad
    player.x = targetPad.x;
    player.y = targetPad.y;
    io.emit('playerMoved', { id: socket.id, x: player.x, y: player.y });
  });

  // Handle tongue attack
  socket.on('tongueAttack', (targetId) => {
    const attacker = gameState.players.get(socket.id);
    const target = gameState.players.get(targetId);
    
    if (attacker && target) {
      const damage = attacker.size * 10;
      target.health -= damage;
      
      if (target.health <= 0) {
        gameState.players.delete(targetId);
        io.emit('playerDied', targetId);
      } else {
        io.emit('playerDamaged', { id: targetId, health: target.health });
      }
    }
  });

  // Handle fly catch
  socket.on('catchFly', (flyId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const flyIndex = gameState.flies.findIndex(fly => fly.id === flyId);
    if (flyIndex !== -1) {
      // Remove caught fly
      gameState.flies.splice(flyIndex, 1);
      player.size += 0.1;
      player.health = Math.min(100, player.health + 20);
      
      io.emit('flyCaught', { flyId, playerId: socket.id, size: player.size, health: player.health });
      
      // Generate one new fly when one is caught
      const newFly = generateFly();
      gameState.flies.push(newFly);
      io.emit('newFly', newFly);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    if (gameState.players.has(socket.id)) {
      gameState.players.delete(socket.id);
      io.emit('playerDisconnected', socket.id);
    }
  });
});

// Update fly positions periodically
setInterval(() => {
  gameState.flies.forEach(fly => {
    const dx = fly.targetX - fly.x;
    const dy = fly.targetY - fly.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Pick new target when close to current target
    if (distance < 5) {
      const angle = Math.random() * Math.PI * 2;
      const targetDistance = 300;
      const newTargetX = fly.x + Math.cos(angle) * targetDistance;
      const newTargetY = fly.y + Math.sin(angle) * targetDistance;
      
      // Keep target within bounds
      fly.targetX = Math.max(0, Math.min(gameState.worldSize.width, newTargetX));
      fly.targetY = Math.max(0, Math.min(gameState.worldSize.height, newTargetY));
    }
    
    // Always move towards target with the fly's speed
    if (distance > 0) {  // Prevent division by zero
      const moveX = (dx / distance) * fly.speed;
      const moveY = (dy / distance) * fly.speed;
      
      fly.x += moveX;
      fly.y += moveY;
    }
    
    // Add small random movement
    fly.x += (Math.random() - 0.5);
    fly.y += (Math.random() - 0.5);
    
    // Ensure flies stay within bounds
    fly.x = Math.max(0, Math.min(gameState.worldSize.width, fly.x));
    fly.y = Math.max(0, Math.min(gameState.worldSize.height, fly.y));
  });
  
  io.emit('fliesUpdated', gameState.flies);
}, 1000 / 60);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 