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

// Store player names separately to persist through respawns
const playerNames = new Map();

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

// Helper function to find an unoccupied lily pad
function findUnoccupiedLilyPad() {
  // Get all lily pads that aren't occupied by any player
  const unoccupiedPads = gameState.lilyPads.filter(pad => {
    return !Array.from(gameState.players.values()).some(player => 
      player.x === pad.x && player.y === pad.y
    );
  });
  
  if (unoccupiedPads.length === 0) return gameState.lilyPads[0]; // Fallback to first pad if all are occupied
  return unoccupiedPads[Math.floor(Math.random() * unoccupiedPads.length)];
}

function getRequiredXPForLevel(level) {
  // Each level requires more XP than the last
  // Level 1->2: 3 flies
  // Level 2->3: 5 flies
  // Level 3->4: 7 flies
  // And so on...
  return (level * 2) + 1;
}

function getLevelFromXP(xp) {
  // Start at level 1 and keep checking if we have enough XP for next level
  let level = 1;
  let xpRequired = 0;
  
  while (true) {
    xpRequired += getRequiredXPForLevel(level);
    if (xp < xpRequired) {
      return level;
    }
    level++;
  }
}

function getSizeForLevel(level) {
  // Start at size 0.7, each level increases size by 0.1 (reduced from 0.2)
  return 0.7 + ((level - 1) * 0.1);
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Handle new player
  socket.on('newPlayer', (playerName) => {
    const spawnPad = findUnoccupiedLilyPad();
    
    // Store the player name
    playerNames.set(socket.id, playerName);
    
    const player = {
      id: socket.id,
      name: playerName,
      x: spawnPad.x,
      y: spawnPad.y,
      size: 0.7, // Reduced from 1
      health: 100,
      maxHealth: 100,
      isSwimming: false,
      lastPushTime: 0,
      level: 1,
      xp: 0
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

  // Handle player respawn
  socket.on('respawn', () => {
    const spawnPad = findUnoccupiedLilyPad();
    const existingPlayer = gameState.players.get(socket.id);
    
    const player = {
      id: socket.id,
      name: existingPlayer?.name || playerNames.get(socket.id) || 'Anonymous',
      x: spawnPad.x,
      y: spawnPad.y,
      size: 0.7, // Reduced from 1
      health: 100,
      maxHealth: 100,
      isSwimming: false,
      lastPushTime: 0,
      level: 1,
      xp: 0
    };
    gameState.players.set(socket.id, player);
    
    // Broadcast respawned player to all players
    io.emit('playerJoined', player);
  });

  // Handle player movement
  socket.on('moveToLilyPad', (padId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    
    // Can't move while swimming
    if (player.isSwimming) return;

    const targetPad = gameState.lilyPads.find(pad => pad.id === padId);
    if (!targetPad) return;

    // Check for smaller frogs on the target pad
    const currentTime = Date.now();
    for (const [otherId, otherPlayer] of gameState.players.entries()) {
      if (otherId !== socket.id && 
          otherPlayer.x === targetPad.x && 
          otherPlayer.y === targetPad.y && 
          otherPlayer.size < player.size &&
          !otherPlayer.isSwimming &&
          currentTime - otherPlayer.lastPushTime > 2000) { // Prevent rapid pushing
        
        // Push the smaller frog into water
        otherPlayer.isSwimming = true;
        otherPlayer.lastPushTime = currentTime;
        
        // After 1 second, allow the frog to move again
        setTimeout(() => {
          if (otherPlayer.isSwimming) {
            otherPlayer.isSwimming = false;
            io.emit('playerCanMove', otherId);
          }
        }, 1000);
        
        // Emit push event
        io.emit('playerPushed', {
          id: otherId,
          pushedBy: socket.id,
          fromX: otherPlayer.x,
          fromY: otherPlayer.y
        });
      }
    }

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
      const damage = Math.round(attacker.size * 20); // Adjusted base damage to account for smaller size
      target.health = Math.max(0, target.health - damage); // Prevent negative health
      
      if (target.health <= 0) {
        gameState.players.delete(targetId);
        io.emit('playerDied', targetId);
      } else {
        io.emit('playerDamaged', { 
          id: targetId, 
          health: target.health,
          maxHealth: target.maxHealth,
          damage: damage 
        });
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
      
      // Add XP and check for level up
      player.xp++;
      const newLevel = getLevelFromXP(player.xp);
      const didLevelUp = newLevel > player.level;
      
      if (didLevelUp) {
        // Level up! Update size and max health
        player.level = newLevel;
        player.size = getSizeForLevel(newLevel);
        player.maxHealth = 100 + ((newLevel - 1) * 25); // Increased HP gain per level from 20 to 25
        player.health = player.maxHealth; // Heal to full on level up
      } else if (player.health < player.maxHealth) {
        // If didn't level up, just heal if not at full health
        player.health = Math.min(player.maxHealth, player.health + 30);
      }
      
      io.emit('flyCaught', { 
        flyId, 
        playerId: socket.id, 
        size: player.size, 
        health: player.health,
        maxHealth: player.maxHealth,
        level: player.level,
        xp: player.xp,
        didLevelUp
      });
      
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
      playerNames.delete(socket.id);
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