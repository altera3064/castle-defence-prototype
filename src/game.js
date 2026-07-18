(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const mapTexture = new Image();
  mapTexture.src = "asset/%EB%A7%B5.png";
  const mountainTexture = new Image();
  mountainTexture.src = "asset/%EC%82%B0-%ED%88%AC%EB%AA%85.png";
  const WALL_MASK_TO_FILE = [
    "1.png",
    "11.png",
    "10.png",
    "5.png",
    "8.png",
    "7.png",
    "4.png",
    "12.png",
    "9.png",
    "3.png",
    "6.png",
    "13.png",
    "2.png",
    "14.png",
    "15.png",
    "16.png",
  ];
  const WALL_SPRITE_BASE = "asset/%EC%84%B1%EB%B2%BD%20%EC%97%90%EC%85%8B%20(1)/";
  const WALL_SPRITE_SOURCE = { x: 94, y: 27, width: 325, height: 452 };
  const WALL_SPRITE_RENDER = { lift: 16, sideBleed: 3, height: 40 };
  const wallSprites = Array(16).fill(null);
  const wallRawImages = Array(16).fill(null);
  const UNIT_ANIMATION_STATES = ["idle", "walk", "attack", "hit", "death"];
  const UNIT_FRAME_COUNT = 3;
  const UNIT_ANIMATION_DURATIONS = {
    idle: 0.72,
    walk: 0.42,
    attack: 0.3,
    hit: 0.24,
    death: 0.48,
  };
  const UNIT_SPRITE_SCALE = {
    melee: 1.45,
    archer: 0.95,
    catapult: 1.45,
    runner: 0.85,
    bruiser: 1.0,
    siege: 1.25,
    boss: 2.35,
  };
  const UNIT_SPRITE_FILES = {
    melee: "asset/units/%EA%B7%BC%EC%A0%91%EB%B3%91%20%EC%97%90%EC%85%8B/melee.png",
  };
  const unitSprites = {};
  ["melee", "archer", "catapult", "runner", "bruiser", "siege", "boss"].forEach((type) => {
    const image = new Image();
    image.src = UNIT_SPRITE_FILES[type] || `asset/units/${type}.png`;
    unitSprites[type] = image;
  });
  const ui = {
    gold: document.getElementById("gold"),
    wave: document.getElementById("wave"),
    enemies: document.getElementById("enemies"),
    core: document.getElementById("core"),
    readout: document.getElementById("readout"),
    status: document.getElementById("status"),
    startWave: document.getElementById("startWave"),
    recruitMelee: document.getElementById("recruitMelee"),
    recruitArcher: document.getElementById("recruitArcher"),
    recruitCatapult: document.getElementById("recruitCatapult"),
    meteor: document.getElementById("meteor"),
    knockback: document.getElementById("knockback"),
    upgradeSoldiers: document.getElementById("upgradeSoldiers"),
    upgradeTowers: document.getElementById("upgradeTowers"),
    upgradeWalls: document.getElementById("upgradeWalls"),
    buildMode: document.getElementById("buildMode"),
    productionMode: document.getElementById("productionMode"),
    upgradeMode: document.getElementById("upgradeMode"),
    buildPanel: document.getElementById("buildPanel"),
    productionPanel: document.getElementById("productionPanel"),
    upgradePanel: document.getElementById("upgradePanel"),
    gameOverOverlay: document.getElementById("gameOverOverlay"),
    retryGame: document.getElementById("retryGame"),
  };

  const COLS = 44;
  const ROWS = 28;
  const CELL = 24;
  const VALLEY_TOP = 6;
  const VALLEY_BOTTOM = 21;
  const HUMAN_TERRITORY_END = 16;
  const MOUNTAIN_LEFT = 17;
  const MOUNTAIN_RIGHT = 28;
  const MONSTER_TERRITORY_START = 35;
  const WALL_BUILD_MIN_X = HUMAN_TERRITORY_END + 1;
  const WALL_BUILD_MAX_X = MONSTER_TERRITORY_START - 8;
  const WALL_BUILD_MIN_Y = VALLEY_TOP + 1;
  const WALL_BUILD_MAX_Y = VALLEY_BOTTOM - 1;
  const MONSTER_SPAWN_LINE_X = COLS - 3;
  const CORE = { x: 8, y: 14, hp: 1200, maxHp: 1200 };
  const MAX_SQUAD_SIZE = 30;
  const MAX_CATAPULTS = 10;
  const SOLDIER_WALK_SPEED_THRESHOLD = 0.18;
  const WORLD_WIDTH = COLS * CELL;
  const WORLD_HEIGHT = ROWS * CELL;
  const MIN_CAMERA_ZOOM = 0.75;
  const MAX_CAMERA_ZOOM = 2.25;
  const BASE_CANVAS_WIDTH = 1056;
  const BASE_CANVAS_HEIGHT = 672;
  const costs = {
    wall: 5,
    tower: 35,
    meleeBarracks: 30,
    archerBarracks: 30,
    catapultWorkshop: 30,
    melee: 10,
    archer: 15,
    catapult: 80,
  };

  const state = {
    gold: 260,
    wave: 1,
    waveActive: false,
    spawnQueue: [],
    spawnTimer: 0,
    gameOver: false,
    won: false,
    commandMode: "build",
    tool: "wall",
    spellMode: null,
    camera: {
      x: 0,
      y: 0,
      zoom: 1,
      panning: false,
      panStartX: 0,
      panStartY: 0,
      panCameraX: 0,
      panCameraY: 0,
    },
    draggingSquad: null,
    dragStartPoint: null,
    wallDragActive: false,
    eraseDragActive: false,
    lastEraseCell: null,
    eraseVisitedCells: new Set(),
    pendingNormalizeTypes: new Set(),
    recruitHold: null,
    selectedSquad: null,
    grid: [],
    structures: new Map(),
    squads: [],
    monsters: [],
    projectiles: [],
    effects: [],
    deathSprites: [],
    alerts: [],
    hoveredWallKey: null,
    pathDirty: true,
    distances: [],
    upgrades: {
      soldiers: 0,
      towers: 0,
      walls: 0,
    },
    cooldowns: {
      meteor: 0,
      knockback: 0,
    },
    renderScale: 1,
    shake: 0,
  };

  function idx(x, y) {
    return y * COLS + x;
  }

  function inBounds(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  function cellCenter(x, y) {
    return { x: x + 0.5, y: y + 0.5 };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function resizeCanvasForDisplay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(BASE_CANVAS_WIDTH * dpr);
    const targetHeight = Math.round(BASE_CANVAS_HEIGHT * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight || state.renderScale !== dpr) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      state.renderScale = dpr;
    }
  }

  function logicalCanvasWidth() {
    return canvas.width / state.renderScale;
  }

  function logicalCanvasHeight() {
    return canvas.height / state.renderScale;
  }

  function wallAssetPath(fileName) {
    return `${WALL_SPRITE_BASE}${encodeURIComponent(fileName)}`;
  }

  function makeTransparentWallSprite(image) {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const spriteCtx = canvas.getContext("2d");
    spriteCtx.drawImage(image, 0, 0);
    try {
      const imageData = spriteCtx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;
      const visited = new Uint8Array(width * height);
      const queue = [];
      const isWhiteBackground = (x, y) => {
        const i = (y * width + x) * 4;
        return data[i + 3] > 0 && data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244;
      };
      const enqueue = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const key = y * width + x;
        if (visited[key] || !isWhiteBackground(x, y)) return;
        visited[key] = 1;
        queue.push([x, y]);
      };

      for (let x = 0; x < width; x += 1) {
        enqueue(x, 0);
        enqueue(x, height - 1);
      }
      for (let y = 0; y < height; y += 1) {
        enqueue(0, y);
        enqueue(width - 1, y);
      }
      while (queue.length) {
        const [x, y] = queue.pop();
        data[(y * width + x) * 4 + 3] = 0;
        enqueue(x + 1, y);
        enqueue(x - 1, y);
        enqueue(x, y + 1);
        enqueue(x, y - 1);
      }
      spriteCtx.putImageData(imageData, 0, 0);
    } catch (error) {
      return image;
    }
    return canvas;
  }

  function loadWallSprites() {
    WALL_MASK_TO_FILE.forEach((fileName, mask) => {
      const image = new Image();
      image.onload = () => {
        wallSprites[mask] = makeTransparentWallSprite(image);
      };
      image.src = wallAssetPath(fileName);
      wallRawImages[mask] = image;
    });
  }

  function wallSpriteReady(sprite) {
    if (sprite instanceof HTMLCanvasElement) return sprite.width > 0 && sprite.height > 0;
    return Boolean(sprite?.complete && sprite.naturalWidth > 0 && sprite.naturalHeight > 0);
  }

  function hasWall(x, y) {
    if (!inBounds(x, y)) return false;
    return state.structures.get(idx(x, y))?.type === "wall";
  }

  function calculateWallMask(x, y) {
    let mask = 0;
    if (hasWall(x, y - 1)) mask |= 1;
    if (hasWall(x + 1, y)) mask |= 2;
    if (hasWall(x, y + 1)) mask |= 4;
    if (hasWall(x - 1, y)) mask |= 8;
    return mask;
  }

  function updateWallAppearance(x, y) {
    const wall = state.structures.get(idx(x, y));
    if (!wall || wall.type !== "wall") return;
    const mask = calculateWallMask(x, y);
    wall.connectionMask = mask;
    wall.spriteIndex = mask;
    wall.spriteFile = WALL_MASK_TO_FILE[mask];
  }

  function updateWallAndNeighbors(x, y) {
    [
      [x, y],
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ].forEach(([px, py]) => {
      if (hasWall(px, py)) updateWallAppearance(px, py);
    });
  }

  function refreshAllWallAppearances() {
    state.structures.forEach((structure) => {
      if (structure.type === "wall") updateWallAppearance(structure.x, structure.y);
    });
  }

  function wallDebugInfo(x, y) {
    const wall = state.structures.get(idx(x, y));
    if (!wall || wall.type !== "wall") return null;
    const mask = typeof wall.connectionMask === "number" ? wall.connectionMask : calculateWallMask(x, y);
    return {
      x,
      y,
      north: Boolean(mask & 1),
      east: Boolean(mask & 2),
      south: Boolean(mask & 4),
      west: Boolean(mask & 8),
      mask,
      sprite: wall.spriteFile || WALL_MASK_TO_FILE[mask],
      index: mask,
      pivot: "bottom-center",
      renderWidth: CELL + WALL_SPRITE_RENDER.sideBleed * 2,
      renderHeight: WALL_SPRITE_RENDER.height,
    };
  }

  function runWallMaskSelfTest() {
    const previousGrid = state.grid.slice();
    const previousStructures = new Map(state.structures);
    const baseX = WALL_BUILD_MIN_X + 1;
    const baseY = WALL_BUILD_MIN_Y + 1;
    const results = [];
    const setWalls = (positions) => {
      state.grid = previousGrid.slice();
      state.structures = new Map(previousStructures);
      positions.forEach(([x, y]) => {
        const data = { type: "wall", x, y, hp: 180, maxHp: 180, cooldown: 0 };
        state.grid[idx(x, y)] = "wall";
        state.structures.set(idx(x, y), data);
      });
      refreshAllWallAppearances();
    };
    const assertMask = (name, positions, expected) => {
      setWalls(positions.map(([x, y]) => [baseX + x, baseY + y]));
      Object.entries(expected).forEach(([key, mask]) => {
        const [x, y] = key.split(",").map(Number);
        const actual = calculateWallMask(baseX + x, baseY + y);
        results.push({ name, cell: key, expected: mask, actual, pass: actual === mask, sprite: WALL_MASK_TO_FILE[actual] });
      });
    };

    assertMask("single", [[0, 0]], { "0,0": 0 });
    assertMask("horizontal-2", [[0, 0], [1, 0]], { "0,0": 2, "1,0": 8 });
    assertMask("vertical-2", [[0, 0], [0, 1]], { "0,0": 4, "0,1": 1 });
    assertMask("corner", [[0, 0], [1, 0], [0, 1]], { "0,0": 6, "1,0": 8, "0,1": 1 });
    assertMask("square-2x2", [[0, 0], [1, 0], [0, 1], [1, 1]], { "0,0": 6, "1,0": 12, "0,1": 3, "1,1": 9 });
    assertMask("horizontal-3", [[0, 0], [1, 0], [2, 0]], { "0,0": 2, "1,0": 10, "2,0": 8 });
    assertMask("cross", [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], { "1,1": 15 });

    setWalls([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [baseX + x, baseY + y]));
    removeStructure(baseX + 1, baseY + 1, false);
    [
      ["0,0", 6],
      ["1,0", 8],
      ["0,1", 1],
    ].forEach(([key, mask]) => {
      const [x, y] = key.split(",").map(Number);
      const actual = calculateWallMask(baseX + x, baseY + y);
      results.push({ name: "remove-from-2x2", cell: key, expected: mask, actual, pass: actual === mask, sprite: WALL_MASK_TO_FILE[actual] });
    });

    setWalls([[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [baseX + x, baseY + y]));
    destroyStructure(state.structures.get(idx(baseX, baseY)));
    [
      ["1,0", 4],
      ["0,1", 2],
      ["1,1", 9],
    ].forEach(([key, mask]) => {
      const [x, y] = key.split(",").map(Number);
      const actual = calculateWallMask(baseX + x, baseY + y);
      results.push({ name: "destroy-from-2x2", cell: key, expected: mask, actual, pass: actual === mask, sprite: WALL_MASK_TO_FILE[actual] });
    });

    state.grid = previousGrid;
    state.structures = previousStructures;
    refreshAllWallAppearances();
    return results;
  }

  function clampCamera() {
    const camera = state.camera;
    const viewWidth = logicalCanvasWidth();
    const viewHeight = logicalCanvasHeight();
    const scaledWidth = WORLD_WIDTH * camera.zoom;
    const scaledHeight = WORLD_HEIGHT * camera.zoom;
    if (scaledWidth <= viewWidth) {
      camera.x = (viewWidth - scaledWidth) / 2;
    } else {
      camera.x = clamp(camera.x, viewWidth - scaledWidth, 0);
    }
    if (scaledHeight <= viewHeight) {
      camera.y = (viewHeight - scaledHeight) / 2;
    } else {
      camera.y = clamp(camera.y, viewHeight - scaledHeight, 0);
    }
  }

  function screenPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * logicalCanvasWidth(),
      y: ((event.clientY - rect.top) / rect.height) * logicalCanvasHeight(),
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - state.camera.x) / state.camera.zoom,
      y: (point.y - state.camera.y) / state.camera.zoom,
    };
  }

  function setup() {
    loadWallSprites();
    ui.gameOverOverlay.hidden = true;
    state.grid = Array(COLS * ROWS).fill("empty");
    state.distances = Array(COLS * ROWS).fill(Infinity);
    buildTerrain();
    state.grid[idx(CORE.x, CORE.y)] = "core";

    buildStartingKeep();
    refreshAllWallAppearances();
    bindInput();
    setTool("wall");
    setCommandMode("build");
    updateUi();
    requestAnimationFrame(loop);
  }

  function buildTerrain() {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const nearCenter = x >= MOUNTAIN_LEFT && x <= MOUNTAIN_RIGHT;
        const topRidge = nearCenter && y <= VALLEY_TOP;
        const bottomRidge = nearCenter && y >= VALLEY_BOTTOM;
        if (topRidge || bottomRidge) {
          state.grid[idx(x, y)] = "mountain";
        }
      }
    }
  }

  function buildStartingKeep() {
    for (let y = 7; y <= 20; y += 1) {
      placeStructure(22, y, "wall", false);
    }
    placeStructure(14, 11, "meleeBarracks", false);
    placeStructure(14, 17, "archerBarracks", false);
    recruitUnit("melee", false);
    recruitUnit("archer", false);
    placeStructure(22, 9, "tower", false);
    placeStructure(22, 18, "tower", false);
    state.pathDirty = true;
  }

  function bindInput() {
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setTool(button.dataset.tool));
    });

    ui.startWave.addEventListener("click", startWave);
    bindRecruitButton(ui.recruitMelee, "melee");
    bindRecruitButton(ui.recruitArcher, "archer");
    bindRecruitButton(ui.recruitCatapult, "catapult");
    ui.meteor.addEventListener("click", () => armSpell("meteor"));
    ui.knockback.addEventListener("click", () => armSpell("knockback"));
    ui.upgradeSoldiers.addEventListener("click", upgradeSoldiers);
    ui.upgradeTowers.addEventListener("click", upgradeTowers);
    ui.upgradeWalls.addEventListener("click", upgradeWalls);
    ui.buildMode.addEventListener("click", () => setCommandMode("build"));
    ui.productionMode.addEventListener("click", () => setCommandMode("production"));
    ui.upgradeMode.addEventListener("click", () => setCommandMode("upgrade"));
    ui.retryGame.addEventListener("click", retryGame);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", cancelPointerDrag);
    canvas.addEventListener("wheel", onCanvasWheel, { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", (event) => {
      const keyTools = {
        "1": "select",
        "2": "wall",
        "3": "tower",
        "4": "meleeBarracks",
        "5": "archerBarracks",
        "6": "catapultWorkshop",
        "8": "erase",
      };
      if (keyTools[event.key]) setTool(keyTools[event.key]);
      if (event.key.toLowerCase() === "m") armSpell("meteor");
      if (event.key.toLowerCase() === "k") armSpell("knockback");
      if (event.key === " ") {
        event.preventDefault();
        startWave();
      }
    });
  }

  function bindRecruitButton(button, type) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      startRecruitHold(type);
    });
    button.addEventListener("pointerup", finishRecruitHold);
    button.addEventListener("pointerleave", finishRecruitHold);
    button.addEventListener("pointercancel", cancelRecruitHold);
  }

  function startRecruitHold(type) {
    if (state.gameOver) return;
    state.recruitHold = {
      type,
      elapsed: 0,
      count: 1,
    };
    updateRecruitPreview();
  }

  function finishRecruitHold() {
    if (!state.recruitHold) return;
    const hold = state.recruitHold;
    state.recruitHold = null;
    recruitUnits(hold.type, hold.count, true);
    updateUi();
  }

  function cancelRecruitHold() {
    state.recruitHold = null;
    updateUi();
  }

  function updateRecruitHold(dt) {
    if (!state.recruitHold) return;
    state.recruitHold.elapsed += dt;
    const nextCount = state.recruitHold.elapsed < 0.35 ? 1 : 10 + Math.floor((state.recruitHold.elapsed - 0.35) / 0.55) * 10;
    state.recruitHold.count = clamp(nextCount, 1, 300);
    updateRecruitPreview();
  }

  function updateRecruitPreview() {
    if (!state.recruitHold) return;
    const { type, count } = state.recruitHold;
    const actualCount = type === "catapult" ? Math.min(count, availableCatapultSlots()) : count;
    const cost = actualCount * costs[type];
    const label = actualCount > 0 ? `${unitLabel(type)} ${actualCount}명 ${cost}G` : "투석기 최대 10대";
    if (type === "melee") ui.recruitMelee.textContent = label;
    if (type === "archer") ui.recruitArcher.textContent = label;
    if (type === "catapult") ui.recruitCatapult.textContent = label;
  }

  function setTool(tool) {
    state.tool = tool;
    state.spellMode = null;
    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    setStatus(toolLabel(tool));
    updateReadout();
  }

  function setCommandMode(mode) {
    state.commandMode = mode;
    ui.buildMode.classList.toggle("active", mode === "build");
    ui.productionMode.classList.toggle("active", mode === "production");
    ui.upgradeMode.classList.toggle("active", mode === "upgrade");
    ui.buildPanel.classList.toggle("active", mode === "build");
    ui.productionPanel.classList.toggle("active", mode === "production");
    ui.upgradePanel.classList.toggle("active", mode === "upgrade");
    ui.buildPanel.hidden = mode !== "build";
    ui.productionPanel.hidden = mode !== "production";
    ui.upgradePanel.hidden = mode !== "upgrade";
    if (mode !== "build" && state.tool !== "select") setTool("select");
    if (mode === "build" && state.tool === "select") setTool("wall");
    if (mode === "production") setStatus("생산 모드입니다. 병력을 모집하고 전투 명령을 사용하세요.");
    if (mode === "upgrade") setStatus("강화 모드입니다. 방어 시설을 강화하세요.");
    if (mode === "build") setStatus(toolLabel(state.tool));
    updateUi();
  }

  function toolLabel(tool) {
    const labels = {
      select: "부대 선택 모드입니다.",
      wall: "성벽을 배치하세요.",
      tower: "화살탑을 배치하세요.",
      meleeBarracks: "근접 병영을 배치하세요.",
      archerBarracks: "궁수 병영을 배치하세요.",
      catapultWorkshop: "투석기 제작소를 배치하세요.",
      erase: "구조물을 철거합니다.",
    };
    return labels[tool] || "";
  }

  function armSpell(spell) {
    if (state.gameOver) return;
    const remaining = state.cooldowns[spell];
    if (remaining > 0) {
      setStatus(`${spell === "meteor" ? "메테오" : "넉백"} 재사용 대기 ${remaining.toFixed(1)}초`);
      return;
    }
    state.spellMode = spell;
    setStatus(`${spell === "meteor" ? "메테오" : "넉백"} 시전 위치를 클릭하세요.`);
  }

  function onPointerDown(event) {
    if (state.gameOver) return;
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      startCameraPan(event);
      return;
    }
    const point = eventPoint(event);
    const { x, y } = { x: Math.floor(point.x), y: Math.floor(point.y) };
    if (!inBounds(x, y)) {
      if (!state.spellMode && state.tool === "select") startCameraPan(event);
      return;
    }

    if (state.spellMode) {
      castSpell(state.spellMode, x + 0.5, y + 0.5);
      state.spellMode = null;
      return;
    }

    const squad = findSquadAt(x, y) || findSquadFlagAt(point.x, point.y);
    if (squad) {
      state.selectedSquad = squad;
      state.draggingSquad = squad;
      state.camera.panning = false;
      stopTileDrag();
      state.dragStartPoint = point;
      updateReadout();
      return;
    }

    if (state.tool === "erase") {
      state.camera.panning = false;
      state.eraseDragActive = true;
      state.lastEraseCell = { x, y };
      state.eraseVisitedCells = new Set();
      eraseCell(x, y);
      return;
    }

    if (state.tool !== "select") {
      state.camera.panning = false;
      if (state.tool === "wall") {
        state.wallDragActive = true;
      }
      placeStructure(x, y, state.tool, true);
      return;
    }

    startCameraPan(event);
    state.selectedSquad = null;
    updateReadout();
  }

  function onPointerMove(event) {
    if (state.gameOver) return;
    if (state.camera.panning) {
      updateCameraPan(event);
      return;
    }
    const { x, y } = eventCell(event);
    updateHoveredWall(x, y);
    if (!inBounds(x, y)) return;
    if (state.wallDragActive && state.tool === "wall") {
      placeStructure(x, y, "wall", true);
    }
    if (state.eraseDragActive && state.tool === "erase") {
      eraseLine(state.lastEraseCell, { x, y });
      state.lastEraseCell = { x, y };
    }
  }

  function onPointerUp(event) {
    if (state.camera.panning) {
      finishCameraPan(event);
      return;
    }
    if (state.wallDragActive || state.eraseDragActive) {
      stopTileDrag();
      return;
    }
    if (state.gameOver || !state.draggingSquad) return;
    const point = eventPoint(event);
    const { x, y } = { x: Math.floor(point.x), y: Math.floor(point.y) };
    const movedFarEnough = state.dragStartPoint && Math.hypot(point.x - state.dragStartPoint.x, point.y - state.dragStartPoint.y) >= 0.4;
    state.selectedSquad = state.draggingSquad;
    state.draggingSquad = null;
    state.dragStartPoint = null;
    if (movedFarEnough) commandSelectedSquad(x, y);
    updateReadout();
  }

  function stopTileDrag() {
    state.wallDragActive = false;
    state.eraseDragActive = false;
    state.lastEraseCell = null;
    state.eraseVisitedCells.clear();
  }

  function cancelPointerDrag() {
    stopTileDrag();
    state.camera.panning = false;
    state.draggingSquad = null;
    state.dragStartPoint = null;
    state.hoveredWallKey = null;
    updateReadout();
  }

  function startCameraPan(event) {
    const point = screenPoint(event);
    state.camera.panning = true;
    state.camera.panStartX = point.x;
    state.camera.panStartY = point.y;
    state.camera.panCameraX = state.camera.x;
    state.camera.panCameraY = state.camera.y;
    canvas.setPointerCapture?.(event.pointerId);
  }

  function updateCameraPan(event) {
    const point = screenPoint(event);
    state.camera.x = state.camera.panCameraX + point.x - state.camera.panStartX;
    state.camera.y = state.camera.panCameraY + point.y - state.camera.panStartY;
    clampCamera();
  }

  function finishCameraPan(event) {
    updateCameraPan(event);
    state.camera.panning = false;
    canvas.releasePointerCapture?.(event.pointerId);
  }

  function eraseLine(from, to) {
    if (!from) {
      eraseCell(to.x, to.y);
      return;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 1; i <= steps; i += 1) {
      const x = Math.round(from.x + (dx * i) / steps);
      const y = Math.round(from.y + (dy * i) / steps);
      eraseCell(x, y);
    }
  }

  function eraseCell(x, y) {
    const key = idx(x, y);
    if (state.eraseVisitedCells.has(key)) return;
    state.eraseVisitedCells.add(key);
    removeStructure(x, y, true);
  }

  function eventCell(event) {
    const point = eventPoint(event);
    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  }

  function eventPoint(event) {
    const world = screenToWorld(screenPoint(event));
    return { x: world.x / CELL, y: world.y / CELL };
  }

  function updateHoveredWall(x, y) {
    const nextKey = inBounds(x, y) && hasWall(x, y) ? idx(x, y) : null;
    if (state.hoveredWallKey === nextKey) return;
    state.hoveredWallKey = nextKey;
    updateReadout();
  }

  function onCanvasWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const point = screenPoint(event);
    const before = screenToWorld(point);
    const zoomFactor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    state.camera.zoom = clamp(state.camera.zoom * zoomFactor, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
    state.camera.x = point.x - before.x * state.camera.zoom;
    state.camera.y = point.y - before.y * state.camera.zoom;
    clampCamera();
  }

  function canPlace(x, y, type = "default") {
    const unitBlocksPlacement =
      type === "wall" ? hasNonArcherOnCell(x, y) : findSquadAt(x, y);
    const insideWallBuildZone =
      type !== "wall" ||
      (x >= WALL_BUILD_MIN_X && x <= WALL_BUILD_MAX_X && y >= WALL_BUILD_MIN_Y && y <= WALL_BUILD_MAX_Y);
    return inBounds(x, y) && x < MONSTER_TERRITORY_START && insideWallBuildZone && state.grid[idx(x, y)] === "empty" && !unitBlocksPlacement;
  }

  function isMonsterTerritory(x) {
    return x >= MONSTER_TERRITORY_START;
  }

  function hasNonArcherOnCell(x, y) {
    return getAllSoldiers().some((member) => member.type !== "archer" && Math.floor(member.x) === x && Math.floor(member.y) === y);
  }

  function canPlaceTowerOnWall(x, y) {
    const structure = state.structures.get(idx(x, y));
    return !!structure && structure.type === "wall" && !structure.hasTower;
  }

  function canStand(x, y) {
    return inBounds(x, y) && !isBlockedForUnit("default", x, y);
  }

  function isPointBlocked(x, y) {
    return isBlockedForUnit("default", clamp(Math.floor(x), 0, COLS - 1), clamp(Math.floor(y), 0, ROWS - 1));
  }

  function isPointBlockedForUnit(type, x, y) {
    return isBlockedForUnit(type, clamp(Math.floor(x), 0, COLS - 1), clamp(Math.floor(y), 0, ROWS - 1));
  }

  function pushUnitsFromCell(x, y) {
    const movers = getAllSoldiers().filter((member) => member.type !== "archer" && Math.floor(member.x) === x && Math.floor(member.y) === y);
    if (!movers.length) return;
    movers.forEach((member, index) => {
      const destination = findNearestOpenCell(x, y, index);
      if (!destination) return;
      member.x = destination.x + 0.5;
      member.y = destination.y + 0.5;
      const squad = state.squads.find((candidate) => candidate.members.includes(member));
      if (squad) {
        squad.targetX = destination.x + 0.5;
        squad.targetY = destination.y + 0.5;
        squad.flowField = null;
        updateArmyCenter(squad);
      }
    });
  }

  function findNearestOpenCell(x, y, offsetIndex) {
    const directions = [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
    ];
    for (let radius = 1; radius <= 4; radius += 1) {
      for (let i = 0; i < directions.length; i += 1) {
        const dir = directions[(i + offsetIndex) % directions.length];
        const cell = { x: x + dir.x * radius, y: y + dir.y * radius };
        if (canStand(cell.x, cell.y) && !findSquadAt(cell.x, cell.y)) return cell;
      }
    }
    return null;
  }

  function spend(amount) {
    if (state.gold < amount) {
      setStatus("골드가 부족합니다.");
      return false;
    }
    state.gold -= amount;
    updateUi();
    return true;
  }

  function placeStructure(x, y, type, pay) {
    if (pay && state.waveActive && (type === "wall" || type === "tower" || type === "meleeBarracks" || type === "archerBarracks" || type === "catapultWorkshop")) {
      setStatus("웨이브 중에는 방어 시설을 새로 지을 수 없습니다.");
      return false;
    }
    if (isMonsterTerritory(x)) {
      setStatus("몬스터 진영에는 건설할 수 없습니다.");
      return false;
    }
    if (type === "tower" && canPlaceTowerOnWall(x, y)) {
      pushUnitsFromCell(x, y);
      if (pay && !spend(costs.tower)) return false;
      const wall = state.structures.get(idx(x, y));
      wall.hasTower = true;
      wall.cooldown = 0;
      wall.towerHp = 115 + state.upgrades.towers * 12;
      wall.towerMaxHp = wall.towerHp;
      setStatus("성벽 위에 화살탑을 올렸습니다.");
      return true;
    }
    if (type === "tower") {
      setStatus("화살탑은 성벽 위에만 지을 수 있습니다.");
      return false;
    }
    if (!canPlace(x, y, type)) return false;
    if (pay && !spend(costs[type] || 0)) return false;

    const wallBonus = 1 + state.upgrades.walls * 0.25;
    const data = {
      type,
      x,
      y,
      cooldown: 0,
      hp: 120,
      maxHp: 120,
    };
    if (type === "wall") {
      data.hp = Math.round(180 * wallBonus);
      data.maxHp = data.hp;
    }
    if (type === "tower") {
      data.hp = 140;
      data.maxHp = 140;
    }
    if (type === "meleeBarracks" || type === "archerBarracks" || type === "catapultWorkshop") {
      data.hp = 220;
      data.maxHp = 220;
    }

    state.grid[idx(x, y)] = type;
    state.structures.set(idx(x, y), data);
    if (type === "wall") updateWallAndNeighbors(x, y);
    state.pathDirty = true;
    return true;
  }

  function removeStructure(x, y, refund, removeAll = false) {
    const key = idx(x, y);
    const structure = state.structures.get(key);
    if (!structure) return;
    if (structure.hasTower && !removeAll) {
      structure.hasTower = false;
      structure.towerHp = 0;
      structure.towerMaxHp = 0;
      if (refund) state.gold += costs.tower;
      updateUi();
      return;
    }
    const towerRefund = structure.hasTower ? costs.tower : 0;
    state.structures.delete(key);
    state.grid[key] = "empty";
    if (structure.type === "wall") updateWallAndNeighbors(x, y);
    state.pathDirty = true;
    if (refund) state.gold += (costs[structure.type] || 0) + towerRefund;
    updateUi();
  }

  function unitCount(type) {
    return state.squads.reduce((total, squad) => {
      if (squad.type !== type) return total;
      return total + squad.members.length;
    }, 0);
  }

  function availableCatapultSlots() {
    return Math.max(0, MAX_CATAPULTS - unitCount("catapult"));
  }

  function recruitUnit(type, pay) {
    const spawn = findSpawnPoint(type);
    if (!spawn) {
      setStatus(type === "catapult" ? "투석기 제작소가 필요합니다." : type === "archer" ? "궁수 병영이 필요합니다." : "근접 병영이 필요합니다.");
      return false;
    }
    if (type === "catapult" && availableCatapultSlots() <= 0) {
      setStatus("투석기는 최대 10대까지 보유할 수 있습니다.");
      return false;
    }
    if (pay && !spend(costs[type])) return false;
    addSquad(type, spawn.x, spawn.y, false);
    setStatus(`${unitLabel(type)} 모집 완료.`);
    return true;
  }

  function recruitUnits(type, requestedCount, pay) {
    const spawn = findSpawnPoint(type);
    if (!spawn) {
      setStatus(type === "catapult" ? "투석기 제작소가 필요합니다." : type === "archer" ? "궁수 병영이 필요합니다." : "근접 병영이 필요합니다.");
      return false;
    }
    const cappedRequest = type === "catapult" ? Math.min(requestedCount, availableCatapultSlots()) : requestedCount;
    if (cappedRequest <= 0) {
      setStatus(type === "catapult" ? "투석기는 최대 10대까지 보유할 수 있습니다." : "모집할 수 있는 병력이 없습니다.");
      return false;
    }
    const affordable = Math.floor(state.gold / costs[type]);
    const count = pay ? Math.min(cappedRequest, affordable) : cappedRequest;
    if (count <= 0) {
      setStatus("골드가 부족합니다.");
      return false;
    }
    if (pay) {
      state.gold -= count * costs[type];
      updateUi();
    }
    for (let i = 0; i < count; i += 1) {
      addSquad(type, spawn.x, spawn.y, false);
    }
    normalizeSquads(type);
    setStatus(`${unitLabel(type)} ${count}명 모집 완료.`);
    return true;
  }

  function unitLabel(type) {
    if (type === "melee") return "근접병";
    if (type === "archer") return "궁수";
    return "투석기";
  }

  function findSpawnPoint(type) {
    const barracksType = type === "catapult" ? "catapultWorkshop" : type === "archer" ? "archerBarracks" : "meleeBarracks";
    let barracks = null;
    state.structures.forEach((structure) => {
      if (!barracks && structure.type === barracksType) barracks = structure;
    });
    if (!barracks) return null;
    const candidates = [
      { x: barracks.x - 1, y: barracks.y },
      { x: barracks.x, y: barracks.y - 1 },
      { x: barracks.x, y: barracks.y + 1 },
      { x: barracks.x + 1, y: barracks.y },
      { x: barracks.x - 1, y: barracks.y - 1 },
      { x: barracks.x - 1, y: barracks.y + 1 },
    ];
    return candidates.find((cell) => canStand(cell.x, cell.y)) || null;
  }

  function addSquad(type, x, y, pay) {
    if (!canStand(x, y)) return false;
    if (type === "catapult" && unitCount("catapult") >= MAX_CATAPULTS) return false;
    if (pay && !spend(costs[type])) return false;

    let army = state.squads.find((squad) => squad.type === type && squad.members.length < MAX_SQUAD_SIZE);
    if (!army) {
      army = {
        id: `${type}-army-${Math.random().toString(36).slice(2)}`,
        type,
        x: x + 0.5,
        y: y + 0.5,
        targetX: x + 0.5,
        targetY: y + 0.5,
        flowField: null,
        movingToCommand: false,
        formationSize: 0,
        members: [],
      };
      state.squads.push(army);
    }

    const member = createSoldier(type, x + 0.5, y + 0.5);
    const offset = formationOffset(army.members.length, army.members.length + 1);
    member.squadId = army.id;
    member.slot = army.members.length;
    member.x += offset.x * 0.35;
    member.y += offset.y * 0.35;
    army.members.push(member);
    army.formationSize = army.members.length;
    updateArmyCenter(army);
    state.selectedSquad = army;
    updateReadout();
    return true;
  }

  function createSoldier(type, x, y) {
    const level = state.upgrades.soldiers;
    const stats = {
      melee: { hp: 170 + level * 34, damage: 16 + level * 3, range: 1.05, speed: 2.85, radius: 0.34, splash: 0 },
      archer: { hp: 95 + level * 24, damage: 12 + level * 3, range: 5.4, speed: 2.8, radius: 0.24, splash: 0 },
      catapult: { hp: 240 + level * 35, damage: 42 + level * 6, range: 7.2, speed: 1.45, radius: 0.4, splash: 2.0 },
    }[type];
    return {
      id: Math.random().toString(36).slice(2),
      type,
      x,
      y,
      hp: stats.hp,
      maxHp: stats.hp,
      damage: stats.damage,
      range: stats.range,
      speed: stats.speed,
      radius: stats.radius,
      splash: stats.splash,
      attackTimer: 0,
      animState: "idle",
      animTime: Math.random() * UNIT_ANIMATION_DURATIONS.idle,
      attackAnimTimer: 0,
      hitAnimTimer: 0,
      facing: "right",
    };
  }

  function formationOffset(index, total) {
    if (total <= 1) return { x: 0, y: 0 };
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / cols);
    const col = index % cols;
    const rows = Math.ceil(total / cols);
    return {
      x: (col - (cols - 1) / 2) * 0.72,
      y: (row - (rows - 1) / 2) * 0.72,
    };
  }

  function updateArmyCenter(army) {
    if (!army.members.length) return;
    army.x = army.members.reduce((sum, member) => sum + member.x, 0) / army.members.length;
    army.y = army.members.reduce((sum, member) => sum + member.y, 0) / army.members.length;
  }

  function squadAverageDistanceToCommand(squad) {
    if (!squad.members.length) return 0;
    const total = squad.members.reduce((sum, member) => {
      return sum + Math.hypot(member.x - squad.targetX, member.y - squad.targetY);
    }, 0);
    return total / squad.members.length;
  }

  function setUnitAnimState(unit, stateName) {
    if (unit.animState === stateName) return;
    unit.animState = stateName;
    unit.animTime = 0;
  }

  function updateUnitAnimTimers(unit, dt) {
    unit.animTime += dt;
    unit.attackAnimTimer = Math.max(0, (unit.attackAnimTimer || 0) - dt);
    unit.hitAnimTimer = Math.max(0, (unit.hitAnimTimer || 0) - dt);
  }

  function triggerUnitAnim(unit, stateName) {
    unit.animState = stateName;
    unit.animTime = 0;
    if (stateName === "attack") unit.attackAnimTimer = UNIT_ANIMATION_DURATIONS.attack;
    if (stateName === "hit") unit.hitAnimTimer = UNIT_ANIMATION_DURATIONS.hit;
  }

  function setFacingFromDelta(unit, dx, dy) {
    if (Math.abs(dx) < 0.015 && Math.abs(dy) < 0.015) return;
    unit.facing = dx < 0 ? "left" : "right";
  }

  function damageUnit(unit, amount) {
    unit.hp -= amount;
    if (unit.hp > 0) triggerUnitAnim(unit, "hit");
  }

  function settleUnitCombatAnim(unit) {
    if (unit.attackAnimTimer > 0) setUnitAnimState(unit, "attack");
    else if (unit.hitAnimTimer > 0) setUnitAnimState(unit, "hit");
    else setUnitAnimState(unit, "idle");
  }

  function addDeathSprite(unit) {
    state.deathSprites.push({
      type: unit.type,
      x: unit.x,
      y: unit.y,
      radius: unit.radius,
      facing: unit.facing || "right",
      animState: "death",
      animTime: 0,
      life: UNIT_ANIMATION_DURATIONS.death,
      maxLife: UNIT_ANIMATION_DURATIONS.death,
    });
  }

  function normalizeSquads(type) {
    const squadsOfType = state.squads.filter((squad) => squad.type === type);
    if (!squadsOfType.length) return;
    const selectedType = state.selectedSquad?.type;
    const members = squadsOfType.flatMap((squad) => squad.members).filter((member) => member.hp > 0);
    state.squads = state.squads.filter((squad) => squad.type !== type);
    for (let i = 0; i < members.length; i += MAX_SQUAD_SIZE) {
      const chunk = members.slice(i, i + MAX_SQUAD_SIZE);
      const squadId = `${type}-army-${i / MAX_SQUAD_SIZE}`;
      chunk.forEach((member, slot) => {
        member.squadId = squadId;
        member.slot = slot;
      });
      const x = chunk.reduce((sum, member) => sum + member.x, 0) / chunk.length;
      const y = chunk.reduce((sum, member) => sum + member.y, 0) / chunk.length;
      state.squads.push({
        id: squadId,
        type,
        x,
        y,
        targetX: x,
        targetY: y,
        flowField: null,
        movingToCommand: false,
        formationSize: chunk.length,
        members: chunk,
      });
    }
    if (selectedType === type) {
      state.selectedSquad = state.squads.find((squad) => squad.type === type) || null;
    }
  }

  function findSquadAt(x, y) {
    return state.squads.find((squad) =>
      squad.members.some((member) => Math.floor(member.x) === x && Math.floor(member.y) === y)
    );
  }

  function findSquadFlagAt(x, y) {
    return state.squads.find((squad) => {
      const relativeX = x - squad.x;
      const relativeY = y - squad.y;
      return relativeX >= -0.35 && relativeX <= 0.95 && relativeY >= -1.15 && relativeY <= 0.45;
    });
  }

  function commandSelectedSquad(x, y) {
    if (!state.selectedSquad) return;
    if (!inBounds(x, y) || isBlockedForUnit(state.selectedSquad.type, x, y)) {
      setStatus("부대가 이동할 수 없는 위치입니다.");
      return;
    }
    const flowField = buildUnitFlowField(state.selectedSquad.type, x, y);
    const reachable = state.selectedSquad.members.some((member) => {
      const memberX = clamp(Math.floor(member.x), 0, COLS - 1);
      const memberY = clamp(Math.floor(member.y), 0, ROWS - 1);
      return flowField[idx(memberX, memberY)] < Infinity;
    });
    if (!reachable) {
      setStatus("부대가 갈 수 있는 길이 없습니다.");
      return;
    }
    state.selectedSquad.targetX = x + 0.5;
    state.selectedSquad.targetY = y + 0.5;
    state.selectedSquad.flowField = flowField;
    state.selectedSquad.movingToCommand = true;
    setStatus("부대 이동 명령.");
  }

  function isBlockedForSquad(x, y) {
    return isBlockedForUnit("default", x, y);
  }

  function buildUnitFlowField(unitType, goalX, goalY) {
    const distances = Array(COLS * ROWS).fill(Infinity);
    const queue = [{ x: goalX, y: goalY }];
    distances[idx(goalX, goalY)] = 0;

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const currentDistance = distances[idx(current.x, current.y)];
      neighbors(current.x, current.y).forEach((next) => {
        const key = idx(next.x, next.y);
        if (distances[key] <= currentDistance + 1) return;
        if (key !== idx(goalX, goalY) && isBlockedForUnit(unitType, next.x, next.y)) return;
        distances[key] = currentDistance + 1;
        queue.push(next);
      });
    }

    return distances;
  }

  function isBlockedForUnit(unitType, x, y) {
    const type = state.grid[idx(x, y)];
    if (type === "wall" || type === "wallTower") return unitType !== "archer";
    return type === "mountain" || type === "tower" || type === "core" || type === "meleeBarracks" || type === "archerBarracks" || type === "catapultWorkshop";
  }

  function upgradeSoldiers() {
    const cost = 40 + state.upgrades.soldiers * 22;
    if (!spend(cost)) return;
    state.upgrades.soldiers += 1;
    state.squads.forEach((squad) => {
      squad.members.forEach((member) => {
        member.damage += member.type === "catapult" ? 6 : member.type === "melee" ? 2 : 3;
        const hpGain = member.type === "catapult" ? 35 : member.type === "melee" ? 34 : 24;
        member.maxHp += hpGain;
        member.hp += hpGain;
      });
    });
    setStatus(`병사 강화 ${state.upgrades.soldiers}단계.`);
    updateReadout();
  }

  function upgradeTowers() {
    const cost = towerUpgradeCost();
    if (!spend(cost)) return;
    state.upgrades.towers += 1;
    state.structures.forEach((structure) => {
      if (structure.hasTower) {
        structure.towerMaxHp += 12;
        structure.towerHp += 12;
      }
    });
    setStatus(`타워 강화 ${state.upgrades.towers}단계.`);
    updateReadout();
  }

  function towerUpgradeCost() {
    return 90 + state.upgrades.towers * 75;
  }

  function upgradeWalls() {
    const cost = 60 + state.upgrades.walls * 40;
    if (!spend(cost)) return;
    state.upgrades.walls += 1;
    state.structures.forEach((structure) => {
      if (structure.type === "wall") {
        structure.maxHp += 45;
        structure.hp += 45;
      }
    });
    setStatus(`성벽 강화 ${state.upgrades.walls}단계.`);
    updateReadout();
  }

  function startWave() {
    if (state.waveActive || state.gameOver) return;
    state.waveActive = true;
    state.spawnQueue = makeWave(state.wave);
    state.spawnTimer = 0;
    setCommandMode("production");
    setStatus(`${state.wave} 웨이브 시작.`);
    updateUi();
  }

  function retryGame() {
    window.location.reload();
  }

  function makeWave(wave) {
    const total = 50 + (wave - 1) * 10;
    const queue = [];
    const siegeChance = wave >= 2 ? 0.1 : 0.05;
    const bruiserChance = Math.min(0.45, 0.22 + wave * 0.025);
    for (let i = 0; i < total; i += 1) {
      const roll = Math.random();
      if (roll < siegeChance) queue.push("siege");
      else if (roll < siegeChance + bruiserChance) queue.push("bruiser");
      else queue.push("runner");
    }
    if (wave % 10 === 0) queue.push("boss");
    return queue;
  }

  function spawnMonster(type) {
    const x = COLS + 0.7 + Math.random() * 0.6;
    const y = VALLEY_TOP + 0.6 + Math.random() * (VALLEY_BOTTOM - VALLEY_TOP - 0.2);
    const waveScale = Math.max(0, state.wave - 1);
    const bossTier = Math.max(1, Math.floor(state.wave / 10));
    const base = {
      runner: { hp: 68 + waveScale * 7, speed: 2.35, damage: 12 + waveScale * 1, gold: 2, radius: 0.22 },
      bruiser: { hp: 140 + waveScale * 13, speed: 1.6, damage: 23 + waveScale * 2, gold: 4, radius: 0.28 },
      siege: { hp: 300 + waveScale * 24, speed: 0.9, damage: 45 + waveScale * 3, gold: 10, radius: 0.36 },
      boss: { hp: 2400 + bossTier * 1200 + waveScale * 55, speed: 0.68, damage: 95 + bossTier * 60 + waveScale * 3, gold: 160 + bossTier * 70, radius: 1.0, attackRange: 2.65, splashRadius: 2.35 },
    }[type];
    state.monsters.push({
      type,
      x,
      y,
      hp: base.hp,
      maxHp: base.hp,
      speed: base.speed,
      damage: base.damage,
      gold: base.gold,
      radius: base.radius,
      attackRange: base.attackRange,
      splashRadius: base.splashRadius,
      attackTimer: 0,
      specialTimer: type === "boss" ? 2.2 + Math.random() * 1.8 : 0,
      slow: 0,
      animState: "walk",
      animTime: Math.random() * UNIT_ANIMATION_DURATIONS.walk,
      attackAnimTimer: 0,
      hitAnimTimer: 0,
      facing: "left",
    });
  }

  function castSpell(spell, x, y) {
    if (state.cooldowns[spell] > 0) return;
    if (spell === "meteor") {
      state.cooldowns.meteor = 16;
      const killRadius = 3.0;
      state.effects.push({ type: "meteorStrike", x, y, blastRadius: killRadius, life: 0.72, maxLife: 0.72 });
      state.monsters.forEach((monster) => {
        const d = Math.hypot(monster.x - x, monster.y - y);
        if (d <= killRadius) monster.hp = 0;
      });
      state.shake = 0.3;
      setStatus("메테오 시전.");
    }
    if (spell === "knockback") {
      state.cooldowns.knockback = 11;
      state.effects.push({ type: "knockback", x, y, radius: 0.1, life: 0.55, maxLife: 0.55 });
      state.monsters.forEach((monster) => {
        const dx = monster.x - x;
        const dy = monster.y - y;
        const d = Math.hypot(dx, dy);
        if (d <= 4.2 && d > 0.01) {
          const force = (4.2 - d) / 4.2;
          monster.x += (dx / d) * force * 2.8;
          monster.y += (dy / d) * force * 2.8;
          damageUnit(monster, 25);
          monster.slow = Math.max(monster.slow, 1.4);
        }
      });
      setStatus("넉백 시전.");
    }
    updateUi();
  }

  function computeDistances() {
    state.distances.fill(Infinity);
    const queue = [];
    const start = idx(CORE.x, CORE.y);
    state.distances[start] = 0;
    queue.push({ x: CORE.x, y: CORE.y });

    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      const currentDistance = state.distances[idx(current.x, current.y)];
      neighbors(current.x, current.y).forEach((next) => {
        if (isBlockedForMonster(next.x, next.y)) return;
        const key = idx(next.x, next.y);
        if (state.distances[key] <= currentDistance + 1) return;
        state.distances[key] = currentDistance + 1;
        queue.push(next);
      });
    }
    state.pathDirty = false;
  }

  function neighbors(x, y) {
    return [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ].filter((cell) => inBounds(cell.x, cell.y));
  }

  function isBlockedForMonster(x, y) {
    const type = state.grid[idx(x, y)];
    return type === "mountain" || type === "wall" || type === "tower" || type === "meleeBarracks" || type === "archerBarracks" || type === "catapultWorkshop";
  }

  function loop(now) {
    if (!loop.last) loop.last = now;
    const dt = Math.min(0.033, (now - loop.last) / 1000);
    loop.last = now;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt) {
    if (!state.gameOver) {
      if (state.pathDirty) computeDistances();
      updateCooldowns(dt);
      updateRecruitHold(dt);
      updateWave(dt);
      updateSquads(dt);
      updateTowers(dt);
      updateProjectiles(dt);
      updateMonsters(dt);
      resolveBattlefieldCollisions();
      cleanupDead();
      checkEndConditions();
    }
    updateEffects(dt);
    updateDeathSprites(dt);
    state.shake = Math.max(0, state.shake - dt);
    updateUi();
  }

  function updateCooldowns(dt) {
    state.cooldowns.meteor = Math.max(0, state.cooldowns.meteor - dt);
    state.cooldowns.knockback = Math.max(0, state.cooldowns.knockback - dt);
  }

  function updateWave(dt) {
    if (!state.waveActive) return;
    state.spawnTimer -= dt;
    while (state.spawnQueue.length && state.spawnTimer <= 0) {
      spawnMonster(state.spawnQueue.shift());
      state.spawnTimer += Math.max(0.035, 0.12 - state.wave * 0.008);
    }
  }

  function updateSquads(dt) {
    state.squads.forEach((squad) => {
      const squadDistanceToCommand = Math.hypot(squad.x - squad.targetX, squad.y - squad.targetY);
      const averageDistanceToCommand = squadAverageDistanceToCommand(squad);
      if (squad.movingToCommand && (squadDistanceToCommand <= 0.75 || averageDistanceToCommand <= 1.15)) {
        squad.movingToCommand = false;
        squad.flowField = null;
      }
      squad.members.forEach((member, index) => {
        member.attackTimer -= dt;
        updateUnitAnimTimers(member, dt);
        const slot = member.slot ?? index;
        const formationSize = squad.formationSize || squad.members.length;
        const offset = formationOffset(slot, formationSize);
        const target = squad.movingToCommand ? soldierMoveTarget(squad, member, offset) : { x: member.x, y: member.y };
        const beforeX = member.x;
        const beforeY = member.y;
        const moving = moveSoldier(member, target, dt);
        const moveDx = member.x - beforeX;
        const moveDy = member.y - beforeY;
        const actualSpeed = Math.hypot(moveDx, moveDy) / Math.max(dt, 0.001);
        const distanceToFormation = Math.hypot(target.x - member.x, target.y - member.y);
        const commandDx = target.x - beforeX;
        const commandDy = target.y - beforeY;
        const walking = Boolean(squad.movingToCommand) && moving && actualSpeed >= SOLDIER_WALK_SPEED_THRESHOLD && Math.hypot(commandDx, commandDy) > 0.18;
        if (walking) setFacingFromDelta(member, commandDx, commandDy);
        else member.facing = "right";
        const baseAnimState = walking ? "walk" : "idle";

        const monster = nearestMonster(member.x, member.y, member.range);
        const cannotAttackWhileMoving = walking && distanceToFormation > 0.18;
        if (monster && member.attackTimer <= 0 && !cannotAttackWhileMoving) {
          if (!walking) setFacingFromDelta(member, monster.x - member.x, monster.y - member.y);
          attackMonsterWithSoldier(member, monster);
        }
        if (member.attackAnimTimer > 0 && !walking) setUnitAnimState(member, "attack");
        else if (member.hitAnimTimer > 0) setUnitAnimState(member, "hit");
        else setUnitAnimState(member, baseAnimState);
      });
      updateArmyCenter(squad);
    });
    resolveSoldierCollisions(getAllSoldiers());
    state.squads.forEach(updateArmyCenter);
  }

  function soldierMoveTarget(squad, member, offset) {
    const desiredFormation = { x: squad.targetX + offset.x, y: squad.targetY + offset.y };
    if (!squad.flowField) return desiredFormation;

    const goalDistance = Math.hypot(member.x - desiredFormation.x, member.y - desiredFormation.y);
    if (goalDistance <= 1.1 && !isPointBlockedForUnit(member.type, desiredFormation.x, desiredFormation.y)) {
      return desiredFormation;
    }

    const cx = clamp(Math.floor(member.x), 0, COLS - 1);
    const cy = clamp(Math.floor(member.y), 0, ROWS - 1);
    const currentDistance = squad.flowField[idx(cx, cy)];
    let best = null;
    let bestScore = currentDistance;
    neighbors(cx, cy).forEach((cell) => {
      const score = squad.flowField[idx(cell.x, cell.y)];
      if (score < bestScore && !isBlockedForUnit(member.type, cell.x, cell.y)) {
        bestScore = score;
        best = cell;
      }
    });

    if (!best) return desiredFormation;
    return cellCenter(best.x, best.y);
  }

  function attackMonsterWithSoldier(member, target) {
    member.attackTimer = member.type === "catapult" ? 2.1 : member.type === "melee" ? 0.55 : 0.8;
    triggerUnitAnim(member, "attack");
    if (member.type === "catapult") {
      state.projectiles.push({
        type: "stone",
        x: member.x,
        y: member.y,
        sx: member.x,
        sy: member.y,
        tx: target.x,
        ty: target.y,
        progress: 0,
        speed: 1.45,
        damage: member.damage,
        splash: member.splash,
      });
      return;
    }
    damageUnit(target, member.damage * Math.max(0.35, member.hp / member.maxHp));
    state.effects.push({ type: member.type === "archer" ? "arrow" : "slash", x: member.x, y: member.y, tx: target.x, ty: target.y, life: 0.12, maxLife: 0.12 });
  }

  function updateProjectiles(dt) {
    state.projectiles.forEach((projectile) => {
      projectile.progress += dt * projectile.speed;
      const t = clamp(projectile.progress, 0, 1);
      projectile.x = projectile.sx + (projectile.tx - projectile.sx) * t;
      projectile.y = projectile.sy + (projectile.ty - projectile.sy) * t - Math.sin(t * Math.PI) * 1.8;
      if (projectile.progress >= 1) explodeProjectile(projectile);
    });
    state.projectiles = state.projectiles.filter((projectile) => projectile.progress < 1);
  }

  function explodeProjectile(projectile) {
    state.monsters.forEach((monster) => {
      if (monster.hp <= 0) return;
      const d = Math.hypot(monster.x - projectile.tx, monster.y - projectile.ty);
      if (d > projectile.splash) return;
      const falloff = Math.max(0.35, 1 - d / projectile.splash);
      damageUnit(monster, projectile.damage * 2.4 * falloff);
    });
    state.effects.push({ type: "stoneImpact", x: projectile.tx, y: projectile.ty, radius: projectile.splash, life: 0.38, maxLife: 0.38 });
  }

  function getAllSoldiers() {
    return state.squads.flatMap((squad) => squad.members);
  }

  function moveSoldier(member, target, dt) {
    const d = Math.hypot(target.x - member.x, target.y - member.y);
    if (d <= 0.04) return false;
    const oldX = member.x;
    const oldY = member.y;
    const step = Math.min(d, member.speed * dt);
    const nx = member.x + ((target.x - member.x) / d) * step;
    const ny = member.y + ((target.y - member.y) / d) * step;

    if (!isPointBlockedForUnit(member.type, nx, ny)) {
      member.x = nx;
      member.y = ny;
      return Math.hypot(member.x - oldX, member.y - oldY) > 0.003;
    }
    if (!isPointBlockedForUnit(member.type, nx, member.y)) member.x = nx;
    if (!isPointBlockedForUnit(member.type, member.x, ny)) member.y = ny;
    return Math.hypot(member.x - oldX, member.y - oldY) > 0.003;
  }

  function resolveSoldierCollisions(members) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        if (isAnchoredArcher(members[i]) || isAnchoredArcher(members[j])) continue;
        pushApart(members[i], members[j], members[i].radius + members[j].radius);
      }
    }
    members.forEach((member) => {
      state.monsters.forEach((monster) => {
        const soldierShare = member.type === "archer" ? 0 : member.type === "melee" ? 0.22 : 0.38;
        pushApart(member, monster, member.radius + monster.radius + 0.08, soldierShare, 1 - soldierShare);
      });
    });
  }

  function isAnchoredArcher(member) {
    return member.type === "archer" && state.grid[idx(Math.floor(member.x), Math.floor(member.y))] === "wall";
  }

  function resolveBattlefieldCollisions() {
    const soldiers = getAllSoldiers();
    resolveSoldierCollisions(soldiers);
    for (let i = 0; i < state.monsters.length; i += 1) {
      for (let j = i + 1; j < state.monsters.length; j += 1) {
        const a = state.monsters[i];
        const b = state.monsters[j];
        if (Math.abs(a.x - b.x) > 1.2 || Math.abs(a.y - b.y) > 1.2) continue;
        pushApart(a, b, a.radius + b.radius + 0.03);
      }
    }
  }

  function pushApart(a, b, minDistance, aShare = 0.5, bShare = 0.5) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d >= minDistance) return;
    const overlap = minDistance - d;
    const ax = a.x - (dx / d) * overlap * aShare;
    const ay = a.y - (dy / d) * overlap * aShare;
    const bx = b.x + (dx / d) * overlap * bShare;
    const by = b.y + (dy / d) * overlap * bShare;
    if (!isPointBlocked(ax, ay)) {
      a.x = ax;
      a.y = ay;
    }
    if (!isPointBlocked(bx, by)) {
      b.x = bx;
      b.y = by;
    }
  }

  function updateTowers(dt) {
    state.structures.forEach((tower) => {
      if (tower.type !== "tower" && !tower.hasTower) return;
      tower.cooldown -= dt;
      const target = nearestMonster(tower.x + 0.5, tower.y + 0.5, 6.4);
      if (target && tower.cooldown <= 0) {
        tower.cooldown = Math.max(0.5, 0.85 - state.upgrades.towers * 0.025);
        damageUnit(target, 24 + state.upgrades.towers * 4);
        target.towerAggroKey = idx(tower.x, tower.y);
        target.towerAggroTimer = Math.max(target.towerAggroTimer || 0, 4.2);
        state.effects.push({ type: "bolt", x: tower.x + 0.5, y: tower.y + 0.5, tx: target.x, ty: target.y, life: 0.1, maxLife: 0.1 });
      }
    });
  }

  function updateMonsters(dt) {
    state.monsters.forEach((monster) => {
      if (monster.hp <= 0) return;
      updateUnitAnimTimers(monster, dt);
      monster.attackTimer -= dt;
      if (monster.type === "boss") {
        monster.specialTimer -= dt;
        if (monster.specialTimer <= 0 && castBossLightning(monster)) {
          monster.specialTimer = 4.2 + Math.random() * 2.2;
          return;
        }
      }
      monster.slow = Math.max(0, monster.slow - dt);
      monster.towerAggroTimer = Math.max(0, (monster.towerAggroTimer || 0) - dt);

      const squad = nearestSoldierForMonster(monster);
      if (squad) {
        attackSquad(monster, squad);
        return;
      }

      const towerThreat = adjacentTowerStructure(monster);
      if (towerThreat && (monster.towerAggroTimer > 0 || monster.type === "siege" || monster.type === "boss")) {
        attackStructure(monster, towerThreat);
        return;
      }

      if (dist(monster, { x: CORE.x + 0.5, y: CORE.y + 0.5 }) < 0.75) {
        if (monster.attackTimer <= 0) {
          monster.attackTimer = 0.65;
          triggerUnitAnim(monster, "attack");
          CORE.hp -= monster.damage;
          state.shake = 0.08;
        }
        return;
      }

      const blocking = adjacentStructure(monster);
      if (blocking && (monster.type === "siege" || monster.type === "boss" || !bestStep(monster))) {
        attackStructure(monster, blocking);
        return;
      }

      const moved = moveMonster(monster, dt);
      if (monster.attackAnimTimer > 0) setUnitAnimState(monster, "attack");
      else if (monster.hitAnimTimer > 0) setUnitAnimState(monster, "hit");
      else setUnitAnimState(monster, moved ? "walk" : "idle");
    });
  }

  function attackSquad(monster, squad) {
    if (monster.attackTimer > 0) {
      settleUnitCombatAnim(monster);
      return;
    }
    monster.attackTimer = monster.type === "boss" ? 1.25 : monster.type === "siege" ? 0.95 : 0.72;
    setFacingFromDelta(monster, squad.x - monster.x, squad.y - monster.y);
    triggerUnitAnim(monster, "attack");
    const armor = squad.type === "melee" ? (monster.type === "boss" ? 0.9 : 0.78) : 1;
    damageUnit(squad, monster.damage * armor);
    state.effects.push({ type: "hit", x: squad.x, y: squad.y, life: 0.15, maxLife: 0.15 });
  }

  function castBossLightning(monster) {
    const target = nearestSoldier(monster.x, monster.y, 8.5) || nearestStructurePoint(monster.x, monster.y, 8.5);
    if (!target) return false;
    setFacingFromDelta(monster, target.x - monster.x, target.y - monster.y);
    triggerUnitAnim(monster, "attack");
    const splashRadius = monster.splashRadius || 2.0;
    getAllSoldiers().forEach((member) => {
      const d = Math.hypot(member.x - target.x, member.y - target.y);
      if (d > splashRadius) return;
      const armor = member.type === "melee" ? 0.9 : 1;
      const falloff = Math.max(0.6, 1 - d / (splashRadius * 1.45));
      damageUnit(member, monster.damage * 1.45 * armor * falloff);
    });
    state.structures.forEach((structure) => {
      const sx = structure.x + 0.5;
      const sy = structure.y + 0.5;
      const d = Math.hypot(sx - target.x, sy - target.y);
      if (d > splashRadius) return;
      const falloff = Math.max(0.6, 1 - d / (splashRadius * 1.45));
      const damage = monster.damage * 1.35 * falloff;
      if (structure.hasTower) {
        structure.towerHp = (structure.towerHp || 115) - damage;
        if (structure.towerHp <= 0) {
          structure.hasTower = false;
          structure.towerHp = 0;
          structure.towerMaxHp = 0;
          state.effects.push({ type: "break", x: sx, y: sy - 0.15, life: 0.7, maxLife: 0.7 });
        }
      }
      structure.hp -= damage;
      state.effects.push({ type: "hit", x: sx, y: sy, life: 0.15, maxLife: 0.15 });
      if (structure.hp <= 0) destroyStructure(structure);
    });
    state.effects.push({ type: "bossLightning", x: target.x, y: target.y, radius: splashRadius, life: 0.58, maxLife: 0.58 });
    state.shake = 0.32;
    return true;
  }

  function nearestStructurePoint(x, y, range) {
    let best = null;
    let bestD = range;
    state.structures.forEach((structure) => {
      const sx = structure.x + 0.5;
      const sy = structure.y + 0.5;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bestD) {
        bestD = d;
        best = { x: sx, y: sy };
      }
    });
    return best;
  }

  function attackStructure(monster, structure) {
    if (monster.attackTimer > 0) {
      settleUnitCombatAnim(monster);
      return;
    }
    monster.attackTimer = monster.type === "boss" ? 1.25 : monster.type === "siege" ? 0.75 : 1.0;
    setFacingFromDelta(monster, structure.x + 0.5 - monster.x, structure.y + 0.5 - monster.y);
    triggerUnitAnim(monster, "attack");
    const damage = monster.damage * (monster.type === "boss" ? 1.25 : monster.type === "siege" ? 1.45 : 1);
    if (structure.hasTower) {
      structure.towerHp = (structure.towerHp || 115) - damage;
      state.effects.push({ type: "hit", x: structure.x + 0.5, y: structure.y + 0.35, life: 0.15, maxLife: 0.15 });
      if (structure.towerHp <= 0) {
        structure.hasTower = false;
        structure.towerHp = 0;
        structure.towerMaxHp = 0;
        state.effects.push({ type: "break", x: structure.x + 0.5, y: structure.y + 0.35, life: 0.7, maxLife: 0.7 });
        updateUi();
      }
      return;
    }
    structure.hp -= damage;
    state.effects.push({ type: "hit", x: structure.x + 0.5, y: structure.y + 0.5, life: 0.15, maxLife: 0.15 });
    if (monster.type === "boss") {
      state.effects.push({ type: "bossSmash", x: structure.x + 0.5, y: structure.y + 0.5, radius: 0.2, life: 0.42, maxLife: 0.42 });
      state.shake = 0.18;
    }
    if (structure.hp <= 0) {
      destroyStructure(structure);
    }
  }

  function destroyStructure(structure) {
    state.structures.delete(idx(structure.x, structure.y));
    state.grid[idx(structure.x, structure.y)] = "empty";
    if (structure.type === "wall") updateWallAndNeighbors(structure.x, structure.y);
    state.pathDirty = true;
    state.shake = 0.18;
    state.effects.push({ type: "break", x: structure.x + 0.5, y: structure.y + 0.5, life: 0.7, maxLife: 0.7 });
  }

  function directionName(x, y) {
    if (y < CORE.y - 3) return "북쪽";
    if (y > CORE.y + 3) return "남쪽";
    if (x < CORE.x) return "서쪽";
    return "동쪽";
  }

  function moveMonster(monster, dt) {
    const step = bestStep(monster);
    let target;
    if (step) {
      target = cellCenter(step.x, step.y);
    } else {
      target = { x: CORE.x + 0.5, y: CORE.y + 0.5 };
      const nextCell = {
        x: clamp(Math.floor(monster.x + Math.sign(target.x - monster.x) * 0.55), 0, COLS - 1),
        y: clamp(Math.floor(monster.y + Math.sign(target.y - monster.y) * 0.55), 0, ROWS - 1),
      };
      const blocked = state.structures.get(idx(nextCell.x, nextCell.y));
      if (blocked) {
        attackStructure(monster, blocked);
        return false;
      }
    }

    const d = Math.hypot(target.x - monster.x, target.y - monster.y);
    if (d <= 0.01) return false;
    const speed = monster.speed * (monster.slow > 0 ? 0.45 : 1);
    const amount = Math.min(d, speed * dt);
    const oldX = monster.x;
    const oldY = monster.y;
    monster.x += ((target.x - monster.x) / d) * amount;
    monster.y += ((target.y - monster.y) / d) * amount;
    setFacingFromDelta(monster, monster.x - oldX, monster.y - oldY);
    return amount > 0.01;
  }

  function bestStep(monster) {
    const cx = clamp(Math.floor(monster.x), 0, COLS - 1);
    const cy = clamp(Math.floor(monster.y), 0, ROWS - 1);
    const current = state.distances[idx(cx, cy)];
    let best = null;
    let bestScore = current;
    neighbors(cx, cy).forEach((cell) => {
      const score = state.distances[idx(cell.x, cell.y)];
      if (score < bestScore && !isBlockedForMonster(cell.x, cell.y)) {
        bestScore = score;
        best = cell;
      }
    });
    return best;
  }

  function adjacentStructure(monster) {
    const cx = clamp(Math.floor(monster.x), 0, COLS - 1);
    const cy = clamp(Math.floor(monster.y), 0, ROWS - 1);
    let found = null;
    neighbors(cx, cy).some((cell) => {
      const structure = state.structures.get(idx(cell.x, cell.y));
      if (structure) {
        found = structure;
        return true;
      }
      return false;
    });
    return found;
  }

  function adjacentTowerStructure(monster) {
    const remembered = state.structures.get(monster.towerAggroKey);
    if (remembered && remembered.hasTower && Math.hypot(remembered.x + 0.5 - monster.x, remembered.y + 0.5 - monster.y) <= 1.35) {
      return remembered;
    }

    const cx = clamp(Math.floor(monster.x), 0, COLS - 1);
    const cy = clamp(Math.floor(monster.y), 0, ROWS - 1);
    let found = null;
    neighbors(cx, cy).some((cell) => {
      const structure = state.structures.get(idx(cell.x, cell.y));
      if (structure?.hasTower) {
        found = structure;
        return true;
      }
      return false;
    });
    return found;
  }

  function nearestMonster(x, y, range) {
    let best = null;
    let bestD = range;
    state.monsters.forEach((monster) => {
      if (monster.hp <= 0) return;
      const d = Math.hypot(monster.x - x, monster.y - y);
      if (d < bestD) {
        bestD = d;
        best = monster;
      }
    });
    return best;
  }

  function nearestSquad(x, y, range) {
    let best = null;
    let bestD = range;
    state.squads.forEach((squad) => {
      squad.members.forEach((member) => {
        if (member.hp <= 0) return;
        const d = Math.hypot(member.x - x, member.y - y);
        if (d < bestD) {
          bestD = d;
          best = member;
        }
      });
    });
    return best;
  }

  function nearestSoldier(x, y, range) {
    let best = null;
    let bestD = range;
    getAllSoldiers().forEach((member) => {
      if (member.hp <= 0) return;
      const d = Math.hypot(member.x - x, member.y - y);
      if (d < bestD) {
        bestD = d;
        best = member;
      }
    });
    return best;
  }

  function nearestSoldierForMonster(monster) {
    let best = null;
    let bestScore = Infinity;
    state.squads.forEach((squad) => {
      squad.members.forEach((member) => {
        if (member.hp <= 0) return;
        const d = Math.hypot(member.x - monster.x, member.y - monster.y);
        const contactRange = monster.attackRange || monster.radius + member.radius + 0.2;
        if (d > contactRange) return;
        const frontlineBias = member.type === "melee" ? 0.22 : 0;
        const score = d - frontlineBias;
        if (score < bestScore) {
          bestScore = score;
          best = member;
        }
      });
    });
    return best;
  }

  function cleanupDead() {
    const before = state.monsters.length;
    state.monsters = state.monsters.filter((monster) => {
      if (monster.hp > 0) return true;
      state.gold += monster.gold;
      addDeathSprite(monster);
      state.effects.push({ type: "gold", x: monster.x, y: monster.y, life: 0.55, maxLife: 0.55 });
      return false;
    });
    if (before !== state.monsters.length) updateUi();

    const changedTypes = new Set();
    state.squads = state.squads.filter((squad) => {
      const beforeMembers = squad.members.length;
      squad.members = squad.members.filter((member) => {
        if (member.hp > 0) return true;
        addDeathSprite(member);
        state.effects.push({ type: "break", x: member.x, y: member.y, life: 0.7, maxLife: 0.7 });
        return false;
      });
      if (beforeMembers !== squad.members.length) {
        changedTypes.add(squad.type);
        updateArmyCenter(squad);
      }
      if (squad.members.length) return true;
      if (state.selectedSquad === squad) state.selectedSquad = null;
      return false;
    });
    changedTypes.forEach((type) => {
      if (state.waveActive) state.pendingNormalizeTypes.add(type);
      else normalizeSquads(type);
    });
  }

  function normalizePendingSquads() {
    state.pendingNormalizeTypes.forEach((type) => normalizeSquads(type));
    state.pendingNormalizeTypes.clear();
  }

  function checkEndConditions() {
    if (CORE.hp <= 0) {
      CORE.hp = 0;
      state.gameOver = true;
      state.won = false;
      state.waveActive = false;
      state.spawnQueue = [];
      state.recruitHold = null;
      state.spellMode = null;
      cancelPointerDrag();
      ui.gameOverOverlay.hidden = false;
      setStatus("패배: 코어가 파괴되었습니다.");
      return;
    }

    if (state.waveActive && state.spawnQueue.length === 0 && state.monsters.length === 0) {
      state.waveActive = false;
      state.won = true;
      normalizePendingSquads();
      state.gold += 110 + state.wave * 30;
      setStatus(`${state.wave} 웨이브 섬멸. 다음 웨이브를 준비하세요.`);
      state.wave += 1;
      updateUi();
    }
  }

  function updateEffects(dt) {
    state.effects.forEach((effect) => {
      effect.life -= dt;
      if (effect.radius !== undefined) effect.radius += dt * 7;
    });
    state.effects = state.effects.filter((effect) => effect.life > 0);
    state.alerts.forEach((alert) => {
      alert.life -= dt;
    });
    state.alerts = state.alerts.filter((alert) => alert.life > 0);
  }

  function updateDeathSprites(dt) {
    state.deathSprites.forEach((sprite) => {
      sprite.life -= dt;
      sprite.animTime += dt;
    });
    state.deathSprites = state.deathSprites.filter((sprite) => sprite.life > 0);
  }

  function render() {
    resizeCanvasForDisplay();
    const viewWidth = logicalCanvasWidth();
    const viewHeight = logicalCanvasHeight();
    ctx.setTransform(state.renderScale, 0, 0, state.renderScale, 0, 0);
    ctx.clearRect(0, 0, viewWidth, viewHeight);
    ctx.fillStyle = "#111722";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    clampCamera();
    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake * 18, (Math.random() - 0.5) * state.shake * 18);
    }
    ctx.translate(state.camera.x, state.camera.y);
    ctx.scale(state.camera.zoom, state.camera.zoom);

    drawGround();
    drawMountainCliffs("top");
    drawStructures();
    drawMountainCliffs("bottom");
    drawSquads();
    drawSquadFlags();
    drawMonsters();
    drawDeathSprites();
    drawProjectiles();
    drawEffects();
    drawSelection();
    ctx.restore();
    drawAlerts();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawGround() {
    const viewWidth = logicalCanvasWidth();
    const viewHeight = logicalCanvasHeight();
    ctx.fillStyle = "#1f2a24";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
    if (mapTexture.complete && mapTexture.naturalWidth > 0) {
      ctx.drawImage(mapTexture, 0, 0, viewWidth, viewHeight);
    }
    const mountainTextureReady = mountainTexture.complete && mountainTexture.naturalWidth > 0;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const px = x * CELL;
        const py = y * CELL;
        const isMountain = state.grid[idx(x, y)] === "mountain";
        if (isMountain) {
          if (!mountainTextureReady) {
            ctx.fillStyle = "#32383b";
            ctx.fillRect(px, py, CELL, CELL);
            ctx.fillStyle = "rgba(255,255,255,0.06)";
            ctx.beginPath();
            ctx.moveTo(px + 4, py + CELL - 4);
            ctx.lineTo(px + CELL / 2, py + 5);
            ctx.lineTo(px + CELL - 4, py + CELL - 4);
            ctx.fill();
          }
        } else {
          if (x >= MONSTER_TERRITORY_START) {
            ctx.fillStyle = "rgba(104, 45, 79, 0.055)";
            ctx.fillRect(px, py, CELL, CELL);
          }
        }
        if (!isMountain || !mountainTextureReady) {
          ctx.strokeStyle = "rgba(28, 51, 30, 0.12)";
          ctx.strokeRect(px, py, CELL, CELL);
        }
      }
    }
    const territoryY = VALLEY_TOP * CELL;
    const territoryHeight = (VALLEY_BOTTOM - VALLEY_TOP + 1) * CELL;
    ctx.strokeStyle = "rgba(105, 196, 112, 0.84)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, territoryY + 1, (HUMAN_TERRITORY_END + 1) * CELL - 2, territoryHeight - 2);
    const buildZoneLeft = WALL_BUILD_MIN_X;
    const buildZoneTop = WALL_BUILD_MIN_Y;
    const buildZoneWidth = WALL_BUILD_MAX_X - WALL_BUILD_MIN_X + 1;
    const buildZoneHeight = WALL_BUILD_MAX_Y - WALL_BUILD_MIN_Y + 1;
    ctx.strokeStyle = "rgba(84, 61, 28, 0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(buildZoneLeft * CELL, buildZoneTop * CELL, buildZoneWidth * CELL, buildZoneHeight * CELL);
    ctx.strokeStyle = "rgba(222, 181, 91, 0.88)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(buildZoneLeft * CELL, buildZoneTop * CELL, buildZoneWidth * CELL, buildZoneHeight * CELL);
    ctx.setLineDash([]);
    drawTerritoryLabel("인간 진영", 12, VALLEY_TOP * CELL + 18, "#d5ead0");
    drawTerritoryLabel("몬스터 진영", (MONSTER_TERRITORY_START + 1) * CELL, VALLEY_TOP * CELL + 18, "#efd5df");
  }

  function drawMountainCliffs(section = "both") {
    if (!mountainTexture.complete || mountainTexture.naturalWidth === 0) return;
    const height = logicalCanvasHeight();
    const viewWidth = logicalCanvasWidth();
    const width = height * (mountainTexture.naturalWidth / mountainTexture.naturalHeight);
    const x = (viewWidth - width) / 2;
    const originalOffset = Math.round(height * 0.12);
    const topClipHeight = Math.round(height * 0.4);
    const bottomClipY = Math.round(height * 0.6);

    if (section === "top" || section === "both") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, viewWidth, topClipHeight);
      ctx.clip();
      ctx.drawImage(mountainTexture, x, -originalOffset + CELL - CELL, width, height);
      ctx.restore();
    }

    if (section === "bottom" || section === "both") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, bottomClipY, viewWidth, height - bottomClipY);
      ctx.clip();
      ctx.drawImage(mountainTexture, x, originalOffset, width, height);
      ctx.restore();
    }
  }

  function drawTerritoryLabel(text, x, y, color) {
    ctx.save();
    ctx.font = "700 11px Arial, 'Noto Sans KR', sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(14, 28, 16, 0.48)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    const width = ctx.measureText(text).width;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.68;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + width, y + 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawStructureTopper(structure, px, py) {
    if (structure.type === "tower" || structure.hasTower) {
      ctx.fillStyle = "#9fc1ff";
      ctx.fillRect(px + 8, py + 6, CELL - 16, CELL - 12);
      if (structure.hasTower) {
        drawHpBar(px + 5, py + 3, CELL - 10, structure.towerHp / structure.towerMaxHp);
      }
    }
  }

  function drawWallSprite(structure, x, y) {
    const mask = typeof structure.connectionMask === "number" ? structure.connectionMask : calculateWallMask(structure.x, structure.y);
    const sprite = wallSprites[mask];
    const lift = WALL_SPRITE_RENDER.lift;
    const sideBleed = WALL_SPRITE_RENDER.sideBleed;
    const drawWidth = CELL + sideBleed * 2;
    const drawHeight = WALL_SPRITE_RENDER.height;
    if (!wallSpriteReady(sprite)) return;
    ctx.drawImage(
      sprite,
      WALL_SPRITE_SOURCE.x,
      WALL_SPRITE_SOURCE.y,
      WALL_SPRITE_SOURCE.width,
      WALL_SPRITE_SOURCE.height,
      x - sideBleed,
      y - lift,
      drawWidth,
      drawHeight
    );
  }

  function drawStructures() {
    const structures = Array.from(state.structures.values());
    const walls = structures
      .filter((structure) => structure.type === "wall")
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const others = structures.filter((structure) => structure.type !== "wall");

    others.forEach((structure) => {
      const px = structure.x * CELL;
      const py = structure.y * CELL;
      if (structure.type === "tower") ctx.fillStyle = "#526e9b";
      if (structure.type === "meleeBarracks") ctx.fillStyle = "#4f8a4f";
      if (structure.type === "archerBarracks") ctx.fillStyle = "#4f7f9f";
      if (structure.type === "catapultWorkshop") ctx.fillStyle = "#9a8242";
      ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      drawStructureTopper(structure, px, py);
      if (structure.type === "meleeBarracks" || structure.type === "archerBarracks" || structure.type === "catapultWorkshop") {
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillRect(px + 6, py + 7, CELL - 12, CELL - 14);
        ctx.fillStyle = structure.type === "meleeBarracks" ? "#284f2b" : structure.type === "archerBarracks" ? "#28506a" : "#6a4a2c";
        ctx.fillRect(px + 9, py + 10, CELL - 18, CELL - 20);
      }
      drawHpBar(px + 3, py + CELL - 6, CELL - 6, structure.hp / structure.maxHp);
    });

    walls.forEach((structure) => {
      const px = structure.x * CELL;
      const py = structure.y * CELL;
      drawWallSprite(structure, px, py);
    });
    walls.forEach((structure) => {
      const px = structure.x * CELL;
      const py = structure.y * CELL;
      drawStructureTopper(structure, px, py);
    });

    const coreX = CORE.x * CELL;
    const coreY = CORE.y * CELL;
    ctx.fillStyle = "#e8bd55";
    ctx.fillRect(coreX + 1, coreY + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = "#7f2d38";
    ctx.fillRect(coreX + 7, coreY + 7, CELL - 14, CELL - 14);
    drawHpBar(coreX + 2, coreY + CELL - 6, CELL - 4, CORE.hp / CORE.maxHp);
  }

  function spriteReady(type) {
    const image = unitSprites[type];
    return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
  }

  function spriteFrameIndex(unit, stateName) {
    const duration = UNIT_ANIMATION_DURATIONS[stateName] || UNIT_ANIMATION_DURATIONS.idle;
    const step = duration / UNIT_FRAME_COUNT;
    if (stateName === "idle" || stateName === "walk") {
      return Math.floor(unit.animTime / step) % UNIT_FRAME_COUNT;
    }
    return clamp(Math.floor(unit.animTime / step), 0, UNIT_FRAME_COUNT - 1);
  }

  function drawUnitSprite(unit, px, py) {
    if (!spriteReady(unit.type)) return false;

    const image = unitSprites[unit.type];
    const stateName = UNIT_ANIMATION_STATES.includes(unit.animState) ? unit.animState : "idle";
    const stateIndex = UNIT_ANIMATION_STATES.indexOf(stateName);
    const frameIndex = spriteFrameIndex(unit, stateName);
    const frameWidth = image.naturalWidth / UNIT_FRAME_COUNT;
    const frameHeight = image.naturalHeight / UNIT_ANIMATION_STATES.length;
    const sourceX = frameWidth * frameIndex;
    const sourceY = frameHeight * stateIndex;
    const scale = UNIT_SPRITE_SCALE[unit.type] || 1;
    const drawWidth = CELL * scale;
    const drawHeight = CELL * scale;
    const footY = py + unit.radius * CELL * 0.85;

    ctx.save();
    if (unit.facing === "right") {
      ctx.translate(px, footY);
      ctx.scale(-1, 1);
      ctx.drawImage(image, sourceX, sourceY, frameWidth, frameHeight, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
    } else {
      ctx.drawImage(image, sourceX, sourceY, frameWidth, frameHeight, px - drawWidth / 2, footY - drawHeight, drawWidth, drawHeight);
    }
    ctx.restore();
    return true;
  }

  function drawFallbackSoldier(member, px, py) {
    if (member.type === "catapult") {
      ctx.fillStyle = "#b9a05b";
      ctx.fillRect(px - member.radius * CELL, py - member.radius * CELL * 0.7, member.radius * CELL * 2, member.radius * CELL * 1.4);
      ctx.fillStyle = "#6a4a2c";
      ctx.fillRect(px + 2, py - 4, member.radius * CELL, 8);
      return;
    }
    ctx.fillStyle = member.type === "melee" ? "#75c46b" : "#7ec7e8";
    ctx.beginPath();
    ctx.arc(px, py, member.radius * CELL, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = member.type === "melee" ? "#284f2b" : "#28506a";
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }

  function drawFallbackMonster(monster, px, py) {
    ctx.fillStyle = monster.type === "boss" ? "#5a223f" : monster.type === "siege" ? "#c24747" : monster.type === "bruiser" ? "#d27a52" : "#bd5ade";
    ctx.beginPath();
    ctx.arc(px, py, monster.radius * CELL, 0, Math.PI * 2);
    ctx.fill();
    if (monster.type === "boss") {
      ctx.strokeStyle = "#ffcf66";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, monster.radius * CELL + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffcf66";
      ctx.fillRect(px - 5, py - 5, 10, 10);
    }
    if (monster.type === "siege") {
      ctx.strokeStyle = "#241316";
      ctx.lineWidth = 3;
      ctx.strokeRect(px - 9, py - 7, 18, 14);
    }
  }

  function drawSquads() {
    state.squads.forEach((squad) => {
      squad.members.forEach((member) => {
        const px = member.x * CELL;
        const py = member.y * CELL;
        if (!drawUnitSprite(member, px, py)) drawFallbackSoldier(member, px, py);
        drawHpBar(px - 8, py + 8, 16, member.hp / member.maxHp);
      });
    });
  }

  function drawMonsters() {
    state.monsters.forEach((monster) => {
      const px = monster.x * CELL;
      const py = monster.y * CELL;
      if (!drawUnitSprite(monster, px, py)) drawFallbackMonster(monster, px, py);
      const hpWidth = monster.type === "boss" ? 42 : 18;
      drawHpBar(px - hpWidth / 2, py - monster.radius * CELL - 8, hpWidth, monster.hp / monster.maxHp);
    });
  }

  function drawDeathSprites() {
    state.deathSprites.forEach((sprite) => {
      const px = sprite.x * CELL;
      const py = sprite.y * CELL;
      if (drawUnitSprite(sprite, px, py)) return;
      ctx.save();
      ctx.globalAlpha = clamp(sprite.life / sprite.maxLife, 0, 1) * 0.65;
      if (sprite.type === "runner" || sprite.type === "bruiser" || sprite.type === "siege" || sprite.type === "boss") {
        drawFallbackMonster(sprite, px, py);
      } else {
        drawFallbackSoldier(sprite, px, py);
      }
      ctx.restore();
    });
  }

  function drawProjectiles() {
    state.projectiles.forEach((projectile) => {
      const px = projectile.x * CELL;
      const py = projectile.y * CELL;
      ctx.fillStyle = "#4f4f4f";
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(px - 1.5, py - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawEffects() {
    state.effects.forEach((effect) => {
      const alpha = clamp(effect.life / effect.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      if (effect.type === "arrow" || effect.type === "bolt") {
        ctx.strokeStyle = effect.type === "bolt" ? "#e8f6ff" : "#c9e7ff";
        ctx.lineWidth = effect.type === "bolt" ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(effect.x * CELL, effect.y * CELL);
        ctx.lineTo(effect.tx * CELL, effect.ty * CELL);
        ctx.stroke();
      }
      if (effect.type === "slash") {
        ctx.strokeStyle = "#d9ffd1";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(effect.tx * CELL, effect.ty * CELL, 9, 0, Math.PI * 1.4);
        ctx.stroke();
      }
      if (effect.type === "meteorStrike") {
        const progress = 1 - alpha;
        const px = effect.x * CELL;
        const py = effect.y * CELL;
        const impact = Math.min(1, progress * 1.8);
        ctx.strokeStyle = `rgba(255, 72, 45, ${0.9 * alpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(px, py, effect.blastRadius * CELL, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 72, 45, ${0.16 * alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, effect.blastRadius * CELL * impact, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 220, 135, ${0.85 * alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 28, py + 28);
        ctx.lineTo(px + 24 - progress * 90, py - 46 + progress * 90);
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 190, 77, ${0.95 * alpha})`;
        ctx.beginPath();
        ctx.arc(px + 24 - progress * 90, py - 46 + progress * 90, 7 + impact * 7, 0, Math.PI * 2);
        ctx.fill();
      }
      if (effect.type === "knockback") {
        ctx.strokeStyle = "rgba(122, 219, 230, 0.7)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(effect.x * CELL, effect.y * CELL, effect.radius * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.type === "bossSmash") {
        ctx.strokeStyle = "rgba(255, 207, 102, 0.82)";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(effect.x * CELL, effect.y * CELL, effect.radius * CELL * 2.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 75, 75, 0.18)";
        ctx.beginPath();
        ctx.arc(effect.x * CELL, effect.y * CELL, effect.radius * CELL * 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (effect.type === "bossLightning") {
        const px = effect.x * CELL;
        const py = effect.y * CELL;
        ctx.strokeStyle = "rgba(156, 221, 255, 0.9)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px - 12, py - 44);
        ctx.lineTo(px + 4, py - 18);
        ctx.lineTo(px - 4, py - 18);
        ctx.lineTo(px + 12, py + 18);
        ctx.stroke();
        ctx.fillStyle = `rgba(106, 184, 255, ${0.18 * alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, effect.radius * CELL, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(156, 221, 255, 0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, effect.radius * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (effect.type === "stoneImpact") {
        const blast = 1 - alpha;
        const px = effect.x * CELL;
        const py = effect.y * CELL;
        ctx.fillStyle = `rgba(255, 132, 54, ${0.28 * alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, effect.radius * CELL * (0.45 + blast * 0.55), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 226, 133, ${0.85 * alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, effect.radius * CELL * (0.35 + blast * 0.65), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(120, 82, 46, ${0.75 * alpha})`;
        for (let i = 0; i < 8; i += 1) {
          const angle = (Math.PI * 2 * i) / 8;
          const distance = effect.radius * CELL * (0.25 + blast * 0.55);
          ctx.beginPath();
          ctx.arc(px + Math.cos(angle) * distance, py + Math.sin(angle) * distance, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (effect.type === "hit") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(effect.x * CELL - 4, effect.y * CELL - 4, 8, 8);
      }
      if (effect.type === "break") {
        ctx.fillStyle = "rgba(255, 85, 85, 0.5)";
        ctx.fillRect(effect.x * CELL - 14, effect.y * CELL - 14, 28, 28);
      }
      if (effect.type === "gold") {
        ctx.fillStyle = "#e8bd55";
        ctx.font = "bold 12px Arial";
        ctx.fillText("+G", effect.x * CELL - 8, effect.y * CELL - 10 - (1 - alpha) * 16);
      }
      ctx.globalAlpha = 1;
    });
  }

  function drawSelection() {
    if (state.selectedSquad) {
      drawSelectedUnitMarkers(state.selectedSquad);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(state.selectedSquad.targetX * CELL, state.selectedSquad.targetY * CELL, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawSelectedUnitMarkers(squad) {
    squad.members.forEach((member) => {
      const px = member.x * CELL;
      const py = member.y * CELL;
      const radius = member.radius * CELL + 3;
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.ellipse(px, py + radius * 0.35, radius * 1.05, radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(px, py + radius * 0.35, radius * 1.05, radius * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function drawSquadFlags() {
    state.squads.forEach((squad) => drawSquadFlag(squad, squad === state.selectedSquad));
  }

  function drawSquadFlag(squad, selected = false) {
    const px = squad.x * CELL;
    const py = squad.y * CELL;
    const color = squad.type === "melee" ? "#75c46b" : squad.type === "archer" ? "#7ec7e8" : "#d6b95f";
    ctx.save();
    ctx.globalAlpha = selected ? 1 : 0.82;
    ctx.strokeStyle = "#f8fbff";
    ctx.lineWidth = selected ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(px, py + 7);
    ctx.lineTo(px, py - 24);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(px + 1, py - 24);
    ctx.lineTo(px + 19, py - 19);
    ctx.lineTo(px + 1, py - 13);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.stroke();
    ctx.fillStyle = "#f8fbff";
    ctx.beginPath();
    ctx.arc(px, py + 8, selected ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAlerts() {
    state.alerts.forEach((alert, index) => {
      ctx.globalAlpha = clamp(alert.life / 0.4, 0, 1);
      ctx.fillStyle = "#e85d5d";
      ctx.font = "bold 18px Arial";
      ctx.fillText(alert.text, 18, 30 + index * 24);
      ctx.globalAlpha = 1;
    });
  }

  function drawHpBar(x, y, width, ratio) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y, width, 4);
    ctx.fillStyle = ratio > 0.45 ? "#75c46b" : ratio > 0.2 ? "#e8bd55" : "#e85d5d";
    ctx.fillRect(x, y, width * clamp(ratio, 0, 1), 4);
  }

  function updateUi() {
    ui.gold.textContent = `Gold ${Math.floor(state.gold)}`;
    ui.wave.textContent = `Wave ${state.wave}`;
    ui.enemies.textContent = `Enemies ${state.monsters.length + state.spawnQueue.length}`;
    ui.core.textContent = `Core ${Math.ceil((CORE.hp / CORE.maxHp) * 100)}%`;
    ui.startWave.disabled = state.waveActive || state.gameOver;
    ui.meteor.textContent = state.cooldowns.meteor > 0 ? `메테오 ${state.cooldowns.meteor.toFixed(0)}s` : "메테오";
    ui.knockback.textContent = state.cooldowns.knockback > 0 ? `넉백 ${state.cooldowns.knockback.toFixed(0)}s` : "넉백";
    if (!state.recruitHold || state.recruitHold.type !== "melee") ui.recruitMelee.textContent = "근접병 1명 10G";
    if (!state.recruitHold || state.recruitHold.type !== "archer") ui.recruitArcher.textContent = "궁수 1명 15G";
    if (!state.recruitHold || state.recruitHold.type !== "catapult") ui.recruitCatapult.textContent = `투석기 1대 80G (${unitCount("catapult")}/${MAX_CATAPULTS})`;
    ui.recruitCatapult.disabled = state.gameOver || availableCatapultSlots() <= 0;
    ui.upgradeSoldiers.textContent = `병사 강화 ${40 + state.upgrades.soldiers * 22}G`;
    ui.upgradeTowers.textContent = `타워 강화 ${towerUpgradeCost()}G`;
    ui.upgradeWalls.textContent = `성벽 강화 ${60 + state.upgrades.walls * 40}G`;
    ui.buildMode.disabled = state.waveActive || state.gameOver;
    ui.productionMode.disabled = state.gameOver;
    ui.upgradeMode.disabled = state.gameOver;
    document.querySelectorAll('[data-tool="wall"], [data-tool="tower"], [data-tool="meleeBarracks"], [data-tool="archerBarracks"], [data-tool="catapultWorkshop"]').forEach((button) => {
      button.disabled = state.waveActive || state.gameOver;
    });
  }

  function updateReadout() {
    if (state.selectedSquad) {
      const label = state.selectedSquad.type === "melee" ? "근접부대" : state.selectedSquad.type === "archer" ? "궁수부대" : "투석기부대";
      const totalHp = state.selectedSquad.members.reduce((sum, member) => sum + Math.max(0, member.hp), 0);
      const maxHp = state.selectedSquad.members.reduce((sum, member) => sum + member.maxHp, 0);
      ui.readout.textContent = `${label} | 인원 ${state.selectedSquad.members.length} | 체력 ${Math.ceil(totalHp)}/${maxHp}`;
      return;
    }
    if (state.hoveredWallKey !== null) {
      const wall = state.structures.get(state.hoveredWallKey);
      if (wall?.type === "wall") {
        const mask = typeof wall.connectionMask === "number" ? wall.connectionMask : calculateWallMask(wall.x, wall.y);
        ui.readout.textContent = `Wall (${wall.x}, ${wall.y}) | N=${!!(mask & 1)} E=${!!(mask & 2)} S=${!!(mask & 4)} W=${!!(mask & 8)} | Mask=${mask} | Sprite=${wall.spriteFile || WALL_MASK_TO_FILE[mask]} | Index=${mask} | Pivot=bottom-center | Size=${CELL + WALL_SPRITE_RENDER.sideBleed * 2}x${WALL_SPRITE_RENDER.height}`;
        return;
      }
    }
    ui.readout.textContent = "선택: 없음";
  }

  function setStatus(message) {
    ui.status.textContent = message;
  }

  window.castleDebug = {
    wallDebugInfo,
    runWallMaskSelfTest,
    refreshAllWallAppearances,
  };

  setup();
  document.documentElement.dataset.wallDebugReady = "true";
  if (new URLSearchParams(window.location.search).has("wallTest")) {
    document.documentElement.dataset.wallMaskSelfTest = JSON.stringify(runWallMaskSelfTest());
  }
})();
