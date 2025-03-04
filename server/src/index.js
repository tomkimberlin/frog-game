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
const takenUsernames = new Set();

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
  const padding = 100;
  
  // Create different speed tiers for flies
  const speedTiers = [
    { min: 3, max: 4 },    // Normal flies (40% chance)
    { min: 4.5, max: 6 },  // Fast flies (35% chance)
    { min: 7, max: 8 }     // Super fast flies (25% chance)
  ];
  
  const rand = Math.random();
  const speedTier = rand < 0.4 ? speedTiers[0] :
                    rand < 0.75 ? speedTiers[1] :
                    speedTiers[2];
  
  return {
    id: `fly-${Date.now()}-${Math.random()}`,
    x: padding + Math.random() * (gameState.worldSize.width - padding * 2),
    y: padding + Math.random() * (gameState.worldSize.height - padding * 2),
    angle: Math.random() * Math.PI * 2,
    angularVelocity: (Math.random() - 0.5) * 0.1,
    speed: speedTier.min + Math.random() * (speedTier.max - speedTier.min),
    nextDirectionChange: Date.now() + 2000 + Math.random() * 3000
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
  // Level 1->2: 5 flies
  // Level 2->3: 8 flies
  // Level 3->4: 11 flies
  // Level 4->5: 14 flies
  // And so on...
  if (level >= 10) return Infinity; // Cap at level 10
  return (level * 3) + 2;
}

function getLevelFromXP(xp) {
  // Start at level 1 and keep checking if we have enough XP for next level
  let level = 1;
  let xpRequired = 0;
  
  while (level < 10) { // Cap at level 10
    xpRequired += getRequiredXPForLevel(level);
    if (xp < xpRequired) {
      return level;
    }
    level++;
  }
  return 10; // Maximum level
}

function getSizeForLevel(level) {
  // Start at size 0.7, each level increases size by 0.05 (reduced from 0.1)
  return 0.7 + ((level - 1) * 0.05);
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Add cooldown tracking at connection level
  const lastAttackTime = new Map();

  // Handle username check
  socket.on('checkName', (name, callback) => {
    console.log(`Checking name availability: ${name}`);
    const isAvailable = !takenUsernames.has(name);
    console.log(`Name "${name}" is ${isAvailable ? 'available' : 'taken'}`);
    callback(isAvailable);
  });

  // Handle new player
  socket.on('newPlayer', (playerName) => {
    // Double-check username length and availability
    if (playerName.length > 16 || takenUsernames.has(playerName)) {
      console.log(`Rejecting player with invalid/taken name: ${playerName}`);
      socket.disconnect();
      return;
    }

    // Add username to taken set
    takenUsernames.add(playerName);
    socket.playerName = playerName;
    console.log(`New player joined with name: ${playerName}`);

    const spawnPad = findUnoccupiedLilyPad();
    
    // Store the player name
    playerNames.set(socket.id, playerName);
    
    const player = {
      id: socket.id,
      name: playerName,
      x: spawnPad.x,
      y: spawnPad.y,
      size: 0.7,
      health: 50,
      maxHealth: 50,
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
    
    // Ensure everyone has the correct health value
    io.emit('playerHealthUpdate', {
      id: socket.id,
      health: player.health,
      maxHealth: player.maxHealth
    });
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
      size: 0.7,
      health: 50,
      maxHealth: 50,
      isSwimming: false,
      lastPushTime: 0,
      level: 1,
      xp: 0
    };
    gameState.players.set(socket.id, player);
    
    // Broadcast respawned player to all players
    io.emit('playerJoined', player);
    
    // Ensure everyone has the correct health value
    io.emit('playerHealthUpdate', {
      id: socket.id,
      health: player.health,
      maxHealth: player.maxHealth
    });
  });

  // Handle player movement
  socket.on('moveToLilyPad', (padId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;
    
    // Can't move while swimming
    if (player.isSwimming) return;

    const targetPad = gameState.lilyPads.find(pad => pad.id === padId);
    if (!targetPad) return;

    // Store current health values
    const currentHealth = player.health;
    const currentMaxHealth = player.maxHealth;

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
    
    // Ensure health values haven't changed during movement
    player.health = currentHealth;
    player.maxHealth = currentMaxHealth;
    
    // Send both movement and health update
    io.emit('playerMoved', { 
      id: socket.id, 
      x: player.x, 
      y: player.y,
      health: player.health,
      maxHealth: player.maxHealth
    });
    
    // Send explicit health update to ensure sync
    io.emit('playerHealthUpdate', {
      id: socket.id,
      health: player.health,
      maxHealth: player.maxHealth
    });
  });

  // Handle tongue attack
  socket.on('tongueAttack', (targetId) => {
    const attacker = gameState.players.get(socket.id);
    const target = gameState.players.get(targetId);
    
    if (!attacker || !target) return;

    // Check cooldown (500ms between attacks)
    const now = Date.now();
    const lastAttack = lastAttackTime.get(targetId) || 0;
    if (now - lastAttack < 500) {
      console.log(`[DAMAGE] Attack ignored - too soon after last attack`);
      return;
    }
    lastAttackTime.set(targetId, now);
    
    console.log(`[DAMAGE] Before attack - Target ${target.name}: HP ${target.health}/${target.maxHealth}`);
    
    // Ensure health is a number and properly set
    if (typeof target.health !== 'number') {
      console.log(`[DAMAGE] Health was not a number, resetting to maxHealth`);
      target.health = target.maxHealth;
    }
    
    // Always do exactly 10 damage
    const oldHealth = target.health;
    target.health = Math.max(0, target.health - 10);
    
    console.log(`[DAMAGE] After attack - Target ${target.name}: HP ${target.health}/${target.maxHealth} (Damage: 10, Old HP: ${oldHealth})`);
    
    // If health drops to 0 or below, player dies
    if (target.health <= 0) {
      console.log(`[DAMAGE] Player died: ${target.name}`);
      gameState.players.delete(targetId);
      io.emit('playerDied', targetId);
    } else {
      io.emit('playerDamaged', { 
        id: targetId, 
        health: target.health,
        maxHealth: target.maxHealth,
        damage: 10
      });
    }
  });

  // Handle fly catch
  socket.on('catchFly', (flyId) => {
    const player = gameState.players.get(socket.id);
    if (!player) return;

    const flyIndex = gameState.flies.findIndex(fly => fly.id === flyId);
    if (flyIndex !== -1) {
      console.log(`[FLY] Before catch - Player ${player.name}: HP ${player.health}/${player.maxHealth}`);
      
      // Remove caught fly
      gameState.flies.splice(flyIndex, 1);
      
      // Add XP and check for level up
      player.xp++;
      const newLevel = getLevelFromXP(player.xp);
      const didLevelUp = newLevel > player.level;
      
      if (didLevelUp) {
        console.log(`[LEVEL] Player ${player.name} leveled up to ${newLevel}`);
        // Level up! Update size and max health
        player.level = newLevel;
        player.size = getSizeForLevel(newLevel);
        player.maxHealth = 50 + ((newLevel - 1) * 10); // 50 base HP + 10 per level
        player.health = player.maxHealth; // Only heal on level up
        console.log(`[LEVEL] New stats - HP: ${player.health}/${player.maxHealth}, Size: ${player.size}`);
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
      // Remove username from taken set
      if (socket.playerName) {
        takenUsernames.delete(socket.playerName);
      }
      io.emit('playerDisconnected', socket.id);
    }
  });
});

// Update fly positions periodically
setInterval(() => {
  const currentTime = Date.now();
  
  gameState.flies.forEach(fly => {
    // Change direction randomly
    if (currentTime >= fly.nextDirectionChange) {
      // Smoother direction changes
      fly.angularVelocity = (Math.random() - 0.5) * 0.1; // Reduced from 0.4 to 0.1
      fly.nextDirectionChange = currentTime + 2000 + Math.random() * 3000; // Changed to 2-5 seconds
    }

    // Update angle for curved movement
    fly.angle += fly.angularVelocity;
    
    // Move in current direction
    fly.x += Math.cos(fly.angle) * fly.speed;
    fly.y += Math.sin(fly.angle) * fly.speed;
    
    // Reduced random movement
    fly.x += (Math.random() - 0.5) * 0.2; // Reduced from 0.5 to 0.2
    fly.y += (Math.random() - 0.5) * 0.2; // Reduced from 0.5 to 0.2
    
    // Bounce off world boundaries with proper angle reflection
    const padding = 50;
    if (fly.x < padding) {
      fly.x = padding;
      fly.angle = Math.PI - fly.angle;
      fly.angularVelocity *= -0.5; // Dampen rotation on bounce
    } else if (fly.x > gameState.worldSize.width - padding) {
      fly.x = gameState.worldSize.width - padding;
      fly.angle = Math.PI - fly.angle;
      fly.angularVelocity *= -0.5; // Dampen rotation on bounce
    }
    
    if (fly.y < padding) {
      fly.y = padding;
      fly.angle = -fly.angle;
      fly.angularVelocity *= -0.5; // Dampen rotation on bounce
    } else if (fly.y > gameState.worldSize.height - padding) {
      fly.y = gameState.worldSize.height - padding;
      fly.angle = -fly.angle;
      fly.angularVelocity *= -0.5; // Dampen rotation on bounce
    }
  });
  
  if (gameState.flies.length > 0) {
    io.emit('fliesUpdated', gameState.flies.map(fly => ({
      id: fly.id,
      x: fly.x,
      y: fly.y,
      angle: fly.angle
    })));
  }
}, 1000 / 60);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 