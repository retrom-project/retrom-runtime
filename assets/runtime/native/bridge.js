(function installRpgRuntimeNativeBridge(global) {
  "use strict";

  const PROTOCOL_VERSION = 1;
  const MAX_CONTROL_BYTES = 64 * 1024;
  const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
  const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
  const EDITOR_CATEGORIES = Object.freeze([
    {id: "gold", label: "金币"}, {id: "items", label: "道具"},
    {id: "weapons", label: "武器"}, {id: "armors", label: "护甲"},
    {id: "variables", label: "变量"}, {id: "switches", label: "开关"},
    {id: "actors", label: "角色"}, {id: "skills", label: "技能"},
    {id: "states", label: "状态"}, {id: "classes", label: "职业"},
    {id: "party", label: "队伍成员"},
  ]);
  const ACTOR_FIELDS = Object.freeze([
    ["hp", "生命"], ["mp", "魔法"], ["tp", "TP"], ["level", "等级"], ["exp", "经验"],
    ["mhp", "最大生命"], ["mmp", "最大魔法"], ["atk", "攻击"],
    ["def", "防御"], ["mat", "魔法攻击"], ["mdf", "魔法防御"],
    ["agi", "敏捷"], ["luk", "幸运"],
  ]);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let launchId = null;
  let nonce = null;
  let parentOrigin = null;
  let port = null;
  let profile = null;
  let cleanupUrl = null;
  let lastRequestId = 0;
  let requestPending = false;
  let frameCount = 0;
  let engineReadySent = false;
  let sceneManagerHooked = false;
  let exitRequested = false;
  let inputDiagnostics = null;

  function ownKeys(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
  }

  function readCleanupUrl(value) {
    if (value === null) return null;
    if (typeof value !== "string" || !global.location) return undefined;
    try {
      const parsed = new URL(value, global.location.href);
      return parsed.origin === global.location.origin ? parsed.href : undefined;
    } catch {
      return undefined;
    }
  }

  function engine() {
    if (profile === "RPGMV") return "RPGMV";
    if (profile === "RPGMZ") return "RPGMZ";
    throw new Error("RPG_NATIVE_PROFILE_INVALID");
  }

  function envelope(requestId, type, body) {
    return { protocolVersion: PROTOCOL_VERSION, launchId, nonce, requestId, type, body };
  }

  function send(requestId, type, body, transfer) {
    if (!port) return;
    const message = envelope(requestId, type, body);
    if (encoder.encode(JSON.stringify(message)).byteLength > MAX_CONTROL_BYTES) {
      throw new Error("RPG_NATIVE_CONTROL_TOO_LARGE");
    }
    port.postMessage(message, transfer || []);
  }

  function event(type, body) {
    send(0, type, body);
  }

  function readyForCheckpoint() {
    const scene = global.SceneManager && global.SceneManager._scene;
    const sceneMap = global.Scene_Map;
    const messageBusy = global.$gameMessage && typeof global.$gameMessage.isBusy === "function" &&
      global.$gameMessage.isBusy();
    const eventBusy = global.$gameMap && typeof global.$gameMap.isEventRunning === "function" &&
      global.$gameMap.isEventRunning();
    return Boolean(scene && sceneMap && scene instanceof sceneMap && !messageBusy && !eventBusy &&
      global.DataManager && global.StorageManager && global.$gameMap &&
      typeof global.$gameMap.mapId === "function" && global.$gameMap.mapId() > 0);
  }

  function engineRuntimeReady() {
    const manager = global.SceneManager;
    const utils = global.Utils;
    const expectedName = profile === "RPGMV" ? "MV" : "MZ";
    return Boolean(manager && typeof manager.updateMain === "function" && global.DataManager &&
      global.StorageManager && utils && utils.RPGMAKER_NAME === expectedName);
  }

  function storageNames(slot) {
    return profile === "RPGMZ" ? ["global", `file${slot}`] : ["0", String(slot)];
  }

  function replaceMethod(target, name, create, restorers) {
    if (!target || typeof target[name] !== "function") return false;
    const original = target[name];
    target[name] = create(original);
    restorers.push(function restoreMethod() { target[name] = original; });
    return true;
  }

  function runGameSystemHook(name) {
    const gameSystem = global.$gameSystem;
    if (gameSystem && typeof gameSystem[name] === "function") gameSystem[name]();
  }

  async function captureNativeSave() {
    if (!readyForCheckpoint()) throw new Error("RPG_CHECKPOINT_UNAVAILABLE");
    const slot = Number(global.DataManager.maxSavefiles()) + 1;
    if (!Number.isSafeInteger(slot) || slot < 1) throw new Error("RPG_CHECKPOINT_SLOT_INVALID");
    const captured = new Map();
    const storage = global.StorageManager;
    const restorers = [];
    const allowed = new Set(storageNames(slot));
    let supported = false;
    if (profile === "RPGMV") {
      supported = replaceMethod(storage, "save", (original) => function runtimeSave(savefileId, json) {
        const key = String(savefileId);
        if (!allowed.has(key)) return original.apply(this, arguments);
        const bytes = encoder.encode(String(json));
        if (!bytes.byteLength || bytes.byteLength > MAX_ENTRY_BYTES) throw new Error("RPG_CHECKPOINT_TOO_LARGE");
        captured.set(key, bytes);
        return undefined;
      }, restorers);
    } else {
      supported = replaceMethod(storage, "saveObject", (original) => async function runtimeSaveObject(saveName, object) {
        const key = String(saveName);
        if (!allowed.has(key)) return original.apply(this, arguments);
        const jsonEx = global.JsonEx;
        if (!jsonEx || typeof jsonEx.stringify !== "function") {
          throw new Error("RPG_CHECKPOINT_STORAGE_UNSUPPORTED");
        }
        const serialized = jsonEx.stringify(object);
        if (typeof serialized !== "string") throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
        const bytes = encoder.encode(serialized);
        if (!bytes.byteLength || bytes.byteLength > MAX_ENTRY_BYTES) throw new Error("RPG_CHECKPOINT_TOO_LARGE");
        captured.set(key, bytes);
        return undefined;
      }, restorers);
    }
    if (!supported) throw new Error("RPG_CHECKPOINT_STORAGE_UNSUPPORTED");
    try {
      runGameSystemHook("onBeforeSave");
      const saved = await global.DataManager.saveGame(slot);
      if (saved === false || !captured.has(storageNames(slot)[1])) throw new Error("RPG_CHECKPOINT_CREATE_FAILED");
    } finally {
      restorers.reverse().forEach((restore) => restore());
    }
    const entries = [...captured.entries()].map(([key, bytes]) => ({
      store: profile === "RPGMZ" ? "LOCALFORAGE" : "LOCAL_STORAGE",
      key,
      mediaType: "application/octet-stream",
      data: bytes.slice().buffer,
    }));
    return { bundle: { engine: engine(), resumeSlot: slot, entries } };
  }

  function validateRestoreBundle(bundle) {
    if (!bundle || bundle.engine !== engine() || !Number.isSafeInteger(bundle.resumeSlot) ||
      bundle.resumeSlot < 1 || !Array.isArray(bundle.entries) || bundle.entries.length < 1 || bundle.entries.length > 2) {
      throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
    }
    const allowed = new Set(storageNames(bundle.resumeSlot));
    const expectedStore = profile === "RPGMZ" ? "LOCALFORAGE" : "LOCAL_STORAGE";
    const entries = new Map();
    for (const entry of bundle.entries) {
      if (!ownKeys(entry, ["data", "key", "mediaType", "store"]) || entry.store !== expectedStore ||
        typeof entry.key !== "string" || !allowed.has(entry.key) || entries.has(entry.key) ||
        !(entry.data instanceof ArrayBuffer) || !entry.data.byteLength || entry.data.byteLength > MAX_ENTRY_BYTES) {
        throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
      }
      entries.set(entry.key, new Uint8Array(entry.data));
    }
    if (!entries.has(storageNames(bundle.resumeSlot)[1])) throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
    return { slot: bundle.resumeSlot, entries };
  }

  async function restoreNativeSave(bundle) {
    const validated = validateRestoreBundle(bundle);
    await waitForDatabase();
    await waitForMZRestoreRuntime();
    const storage = global.StorageManager;
    const restorers = [];
    let supported = false;
    if (profile === "RPGMV") {
      supported = replaceMethod(storage, "load", (original) => function runtimeLoad(savefileId) {
        const value = validated.entries.get(String(savefileId));
        return value ? decoder.decode(value) : original.apply(this, arguments);
      }, restorers);
      replaceMethod(storage, "exists", (original) => function runtimeExists(savefileId) {
        return validated.entries.has(String(savefileId)) || original.apply(this, arguments);
      }, restorers);
    } else {
      supported = replaceMethod(storage, "loadObject", (original) => async function runtimeLoadObject(saveName) {
        const value = validated.entries.get(String(saveName));
        if (!value) return original.apply(this, arguments);
        const jsonEx = global.JsonEx;
        if (!jsonEx || typeof jsonEx.parse !== "function") {
          throw new Error("RPG_CHECKPOINT_STORAGE_UNSUPPORTED");
        }
        return jsonEx.parse(decoder.decode(value));
      }, restorers);
      replaceMethod(storage, "exists", (original) => function runtimeExists(saveName) {
        return validated.entries.has(String(saveName)) || original.apply(this, arguments);
      }, restorers);
    }
    if (!supported) throw new Error("RPG_CHECKPOINT_STORAGE_UNSUPPORTED");
    if (profile === "RPGMV") global.DataManager._globalInfo = null;
    try {
      const loaded = await global.DataManager.loadGame(validated.slot);
      if (loaded === false) throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
      if (global.SceneManager && global.Scene_Map) global.SceneManager.goto(global.Scene_Map);
      runGameSystemHook("onAfterLoad");
      await waitForMap();
    } finally {
      restorers.reverse().forEach((restore) => restore());
    }
    return {};
  }

  function waitForDatabase() {
    const manager = global.DataManager;
    if (!manager || typeof manager.isDatabaseLoaded !== "function") {
      return Promise.reject(new Error("RPG_CHECKPOINT_DATABASE_UNAVAILABLE"));
    }
    const deadline = performance.now() + 30000;
    return new Promise((resolve, reject) => {
      function poll() {
        if (manager.isDatabaseLoaded()) { resolve(); return; }
        if (performance.now() >= deadline) { reject(new Error("RPG_CHECKPOINT_DATABASE_TIMEOUT")); return; }
        global.requestAnimationFrame(poll);
      }
      poll();
    });
  }

  function waitForMZRestoreRuntime() {
    if (profile !== "RPGMZ") return Promise.resolve();
    const deadline = performance.now() + 30000;
    return new Promise((resolve, reject) => {
      function poll() {
        const manager = global.SceneManager;
        const colors = global.ColorManager;
        const graphics = global.Graphics;
        const windowskin = colors && colors._windowskin;
        if (manager && manager._scene && graphics && graphics.width > 0 && graphics.height > 0 &&
          windowskin && typeof windowskin.getPixel === "function") {
          resolve();
          return;
        }
        if (performance.now() >= deadline) { reject(new Error("RPG_CHECKPOINT_RESTORE_TIMEOUT")); return; }
        global.requestAnimationFrame(poll);
      }
      poll();
    });
  }

  function waitForMap() {
    const deadline = performance.now() + 30000;
    return new Promise((resolve, reject) => {
      function poll() {
        const scene = global.SceneManager && global.SceneManager._scene;
        const sceneStarted = scene && (typeof scene.isStarted !== "function" || scene.isStarted());
        if (sceneStarted && readyForCheckpoint()) { resolve(); return; }
        if (performance.now() >= deadline) { reject(new Error("RPG_CHECKPOINT_RESTORE_TIMEOUT")); return; }
        global.requestAnimationFrame(poll);
      }
      poll();
    });
  }

  async function screenshot() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => global.requestAnimationFrame(resolve));
      try {
        const capture = screenshotCanvas();
        if (capture) return await encodeScreenshot(capture);
      } catch {
        // A newly restored WebGL scene may not have presented an extractable frame yet.
      }
    }
    throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
  }

  function encodeScreenshot(capture) {
    return new Promise((resolve, reject) => {
      try {
        capture.canvas.toBlob((blob) => {
          if (!blob || !blob.size || blob.size > MAX_SCREENSHOT_BYTES) {
            capture.release();
            reject(new Error("PLAYER_SCREENSHOT_UNAVAILABLE"));
            return;
          }
          blob.arrayBuffer().then((data) => {
            capture.release();
            resolve({ data, mediaType: blob.type || "image/png" });
          }, (error) => {
            capture.release();
            reject(error);
          });
        }, "image/png");
      } catch (error) {
        capture.release();
        reject(error);
      }
    });
  }

  function screenshotCanvas() {
    const bitmapType = global.Bitmap;
    const scene = global.SceneManager && global.SceneManager._scene;
    if (bitmapType && typeof bitmapType.snap === "function" && scene) {
      const bitmap = bitmapType.snap(scene);
      const canvas = bitmap && bitmap.canvas;
      if (!canvas || typeof canvas.toBlob !== "function") {
        if (bitmap && typeof bitmap.destroy === "function") bitmap.destroy();
        throw new Error("PLAYER_SCREENSHOT_UNAVAILABLE");
      }
      return {
        canvas,
        release: function releaseBitmap() {
          if (typeof bitmap.destroy === "function") bitmap.destroy();
        },
      };
    }
    const canvas = global.document.querySelector("canvas");
    if (!canvas || typeof canvas.toBlob !== "function") return null;
    return { canvas, release: function releaseCanvas() {} };
  }

  function setPaused(paused) {
    const manager = global.SceneManager;
    if (!manager) throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");
    if (paused && typeof manager.stop === "function") manager.stop();
    if (!paused && typeof manager.resume === "function") manager.resume();
    else if (!paused && typeof manager.requestUpdate === "function") {
      manager._stopped = false;
      manager.requestUpdate();
    }
  }

  function setVolume(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 ||
      !global.WebAudio || typeof global.WebAudio.setMasterVolume !== "function") {
      throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");
    }
    global.WebAudio.setMasterVolume(value);
  }

  function setVideoMode(mode) {
    if (mode !== "original" && mode !== "pixel" && mode !== "smooth") {
      throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");
    }
    const canvases = global.document && global.document.querySelectorAll("canvas");
    if (!canvases || !canvases.length) throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");
    const rendering = mode === "pixel" ? "pixelated" : "auto";
    for (const canvas of canvases) {
      if (!canvas || !canvas.style || typeof canvas.style.setProperty !== "function") {
        throw new Error("RPG_RUNTIME_CONTROL_UNAVAILABLE");
      }
      canvas.style.setProperty("image-rendering", rendering, "important");
    }
  }

  function editorReady() {
    return engineRuntimeReady() && global.$gameParty && global.$gameVariables &&
      global.$gameSwitches && global.$dataSystem && global.$gameMap &&
      typeof global.$gameMap.mapId === "function" && global.$gameMap.mapId() > 0;
  }

  function editorEntry(id, label, value, min, max) {
    const name = String(label || id).slice(0, 160);
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      return {id, label: name, value, valueType: "number", min, max};
    }
    if (typeof value === "boolean") return {id, label: name, value, valueType: "boolean"};
    if (typeof value === "string" && value.length <= 500) {
      return {id, label: name, value, valueType: "text"};
    }
    return {id, label: name, value: null, valueType: "unsupported"};
  }

  function editorArrayRows(category) {
    const sources = {items: global.$dataItems, weapons: global.$dataWeapons, armors: global.$dataArmors};
    const source = sources[category];
    if (!Array.isArray(source)) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    const items = source.slice(1).filter((item) => item && Number.isSafeInteger(item.id) && item.id > 0);
    items.sort((left, right) => Number(Boolean(right.name && String(right.name).trim())) -
      Number(Boolean(left.name && String(left.name).trim())));
    return items.map((item) => {
      const name = String(item.name || "").trim();
      const fallback = category === "items" ? "道具" : category === "weapons" ? "武器" : "护甲";
      const maximum = global.$gameParty.maxItems(item);
      return editorEntry(String(item.id), name || `${fallback} ${item.id}`,
        global.$gameParty.numItems(item), 0, Number.isSafeInteger(maximum) ? maximum : 99);
    });
  }

  function editorActorRows(selectedActorId = null) {
    const party = global.$gameParty;
    if (typeof party.members !== "function") throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function") return [];
      const actorId = actor.actorId();
      if (!Number.isSafeInteger(actorId) || actorId < 1) return [];
      if (selectedActorId !== null && actorId !== selectedActorId) return [];
      const actorName = typeof actor.name === "function" ? actor.name() : `#${actorId}`;
      return ACTOR_FIELDS.map(([field, name]) => {
        const parameter = ACTOR_FIELDS.findIndex(([candidate]) => candidate === field) - 5;
        const value = parameter >= 0 ? actor.param(parameter)
          : field === "exp" ? actor.currentExp() : actor[field];
        const maximum = parameter >= 0 ? actor.paramMax(parameter)
          : field === "hp" ? actor.mhp : field === "mp" ? actor.mmp
            : field === "tp" ? actor.maxTp() : field === "level" ? actor.maxLevel() : 999999999;
        return editorEntry(`${actorId}:${field}`, selectedActorId === null ? `${actorName} · ${name}` : name,
          value, field === "level" ? 1 : 0, Number.isSafeInteger(maximum) ? maximum : 999999999);
      });
    });
  }

  function editorPartyGroups(category, requiredMethod = null) {
    const party = global.$gameParty;
    if (!party || typeof party.members !== "function") return [];
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function" ||
        requiredMethod && typeof actor[requiredMethod] !== "function") return [];
      const id = actor.actorId();
      if (!Number.isSafeInteger(id) || id < 1) return [];
      const name = typeof actor.name === "function" ? String(actor.name()).trim() : "";
      return [{id: `${category}:${id}`, label: (name || `角色 ${id}`).slice(0, 160)}];
    });
  }

  function editorSkillRows(selectedActorId = null) {
    const party = global.$gameParty;
    const source = global.$dataSkills;
    if (typeof party.members !== "function" || !Array.isArray(source)) {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    const skills = source.slice(1).filter((skill) => skill && Number.isSafeInteger(skill.id) &&
      skill.id > 0 && String(skill.name || "").trim());
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function" ||
        typeof actor.isLearnedSkill !== "function") return [];
      const actorId = actor.actorId();
      if (!Number.isSafeInteger(actorId) || actorId < 1) return [];
      if (selectedActorId !== null && actorId !== selectedActorId) return [];
      const actorName = typeof actor.name === "function" ? actor.name() : `角色 ${actorId}`;
      return skills.map((skill) => editorEntry(`${actorId}:${skill.id}`,
        selectedActorId === null ? `${actorName} · ${String(skill.name).trim()}` : String(skill.name).trim(),
        Boolean(actor.isLearnedSkill(skill.id))));
    });
  }

  function editorStateRows(selectedActorId = null) {
    const party = global.$gameParty;
    const source = global.$dataStates;
    if (typeof party.members !== "function" || !Array.isArray(source)) {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function" ||
        typeof actor.isStateAffected !== "function") return [];
      const actorId = actor.actorId();
      if (!Number.isSafeInteger(actorId) || actorId < 1 ||
        selectedActorId !== null && actorId !== selectedActorId) return [];
      const deathStateId = typeof actor.deathStateId === "function" ? actor.deathStateId() : 1;
      const actorName = typeof actor.name === "function" ? actor.name() : `角色 ${actorId}`;
      return source.slice(1).filter((state) => state && Number.isSafeInteger(state.id) &&
        state.id > 0 && state.id !== deathStateId).map((state) => {
        const name = String(state.name || "").trim() || `状态 ${state.id}`;
        return editorEntry(`${actorId}:${state.id}`,
          selectedActorId === null ? `${actorName} · ${name}` : name,
          Boolean(actor.isStateAffected(state.id)));
      });
    });
  }

  function editorClassRows(selectedActorId = null) {
    const party = global.$gameParty;
    const source = global.$dataClasses;
    if (typeof party.members !== "function" || !Array.isArray(source)) {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function" ||
        typeof actor.currentClass !== "function") return [];
      const actorId = actor.actorId();
      if (!Number.isSafeInteger(actorId) || actorId < 1 ||
        selectedActorId !== null && actorId !== selectedActorId) return [];
      const actorName = typeof actor.name === "function" ? actor.name() : `角色 ${actorId}`;
      const currentId = actor.currentClass()?.id;
      return source.slice(1).filter((gameClass) => gameClass &&
        Number.isSafeInteger(gameClass.id) && gameClass.id > 0).map((gameClass) => {
        const name = String(gameClass.name || "").trim() || `职业 ${gameClass.id}`;
        return editorEntry(`${actorId}:${gameClass.id}`,
          selectedActorId === null ? `${actorName} · ${name}` : name, gameClass.id === currentId);
      });
    });
  }

  function editorPartyMembers() {
    const party = global.$gameParty;
    const members = typeof party.allMembers === "function" ? party.allMembers() : party.members();
    if (!Array.isArray(members)) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    return members;
  }

  function editorPartyRows() {
    const source = global.$dataActors;
    if (!Array.isArray(source)) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    const members = editorPartyMembers();
    const positions = new Map(members.map((actor, index) => [actor.actorId(), index + 1]));
    return source.slice(1).filter((actor) => actor && Number.isSafeInteger(actor.id) && actor.id > 0)
      .map((actor) => {
        const position = positions.get(actor.id) || 0;
        const member = members.find((candidate) => candidate.actorId() === actor.id);
        const name = String(member && typeof member.name === "function" ? member.name() : actor.name || "").trim();
        return editorEntry(String(actor.id), name || `角色 ${actor.id}`, position, 0,
          position ? members.length : members.length + 1);
      }).sort((left, right) => Number(Boolean(right.value)) - Number(Boolean(left.value)) ||
        Number(left.value || 0) - Number(right.value || 0));
  }

  function editorRows(category) {
    if (!editorReady()) throw new Error("RPG_GAME_EDITOR_NOT_READY");
    const group = /^(actors|skills|states|classes):([1-9]\d*)$/u.exec(category);
    const groupCategory = group ? group[1] : null;
    const selectedActorId = group ? Number(group[2]) : null;
    if (!EDITOR_CATEGORIES.some((entry) => entry.id === category) &&
      (!group || !Number.isSafeInteger(selectedActorId) ||
        !editorPartyGroups(groupCategory, {skills: "isLearnedSkill", states: "isStateAffected",
          classes: "currentClass"}[groupCategory] || null)
          .some((entry) => entry.id === category))) {
      throw new Error("RPG_GAME_EDITOR_INVALID");
    }
    if (category === "gold") {
      const party = global.$gameParty;
      return [editorEntry("gold", "金币", party.gold(), 0, party.maxGold())];
    }
    if (category === "items" || category === "weapons" || category === "armors") {
      return editorArrayRows(category);
    }
    if (category === "skills" || groupCategory === "skills") return editorSkillRows(selectedActorId);
    if (category === "actors" || groupCategory === "actors") return editorActorRows(selectedActorId);
    if (category === "states" || groupCategory === "states") return editorStateRows(selectedActorId);
    if (category === "classes" || groupCategory === "classes") return editorClassRows(selectedActorId);
    if (category === "party") return editorPartyRows();
    if (category === "variables" || category === "switches") {
      const names = category === "variables" ? global.$dataSystem.variables : global.$dataSystem.switches;
      const owner = category === "variables" ? global.$gameVariables : global.$gameSwitches;
      if (!Array.isArray(names) || typeof owner.value !== "function") {
        throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
      }
      const named = [];
      const unnamed = [];
      names.slice(1).forEach((name, index) => {
        const id = index + 1;
        const value = owner.value(id);
        const fallback = category === "variables" ? "变量" : "开关";
        const displayName = String(name || "").trim();
        const row = editorEntry(String(id), displayName || `${fallback} ${id}`, value,
          category === "variables" && typeof value === "number" ? -999999999 : undefined,
          category === "variables" && typeof value === "number" ? 999999999 : undefined);
        (displayName ? named : unnamed).push(row);
      });
      return [...named, ...unnamed];
    }
    throw new Error("RPG_GAME_EDITOR_INVALID");
  }

  function editorList(body) {
    if (!body || typeof body.category !== "string" || typeof body.query !== "string" ||
      body.query.length > 80 || !Number.isSafeInteger(body.offset) || body.offset < 0 ||
      !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 40) {
      throw new Error("RPG_GAME_EDITOR_INVALID");
    }
    const query = body.query.trim().toLowerCase();
    const rows = editorRows(body.category).filter((row) =>
      !query || row.id.includes(query) || row.label.toLowerCase().includes(query));
    return {entries: rows.slice(body.offset, body.offset + body.limit),
      nextOffset: body.offset + body.limit < rows.length ? body.offset + body.limit : null};
  }

  function editorSet(body) {
    if (!body || typeof body.category !== "string" || typeof body.id !== "string" ||
      !/^[a-z0-9:_-]{1,60}$/u.test(body.id)) throw new Error("RPG_GAME_EDITOR_INVALID");
    const entry = editorRows(body.category).find((row) => row.id === body.id);
    if (!entry || entry.valueType === "unsupported" ||
      (entry.valueType === "text" ? typeof body.value !== "string"
        : entry.valueType !== typeof body.value) ||
      entry.valueType === "number" && (!Number.isSafeInteger(body.value) ||
        body.value < entry.min || body.value > entry.max) ||
      entry.valueType === "text" && body.value.length > 500) {
      throw new Error("RPG_GAME_EDITOR_INVALID");
    }
    const value = body.value;
    if (body.category === "gold") {
      global.$gameParty.gainGold(value - global.$gameParty.gold());
    } else if (["items", "weapons", "armors"].includes(body.category)) {
      const source = {items: global.$dataItems, weapons: global.$dataWeapons, armors: global.$dataArmors}[body.category];
      const item = source[Number(body.id)];
      global.$gameParty.gainItem(item, value - global.$gameParty.numItems(item), false);
    } else if (body.category === "variables") {
      global.$gameVariables.setValue(Number(body.id), value);
    } else if (body.category === "switches") {
      global.$gameSwitches.setValue(Number(body.id), value);
    } else if (body.category === "skills" || body.category.startsWith("skills:")) {
      const [actorId, skillId] = body.id.split(":").map(Number);
      const actor = global.$gameParty.members().find((candidate) => candidate.actorId() === actorId);
      if (!actor || typeof actor.learnSkill !== "function" ||
        typeof actor.forgetSkill !== "function") throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
      if (value) actor.learnSkill(skillId);
      else actor.forgetSkill(skillId);
    } else if (body.category === "states" || body.category.startsWith("states:")) {
      const [actorId, stateId] = body.id.split(":").map(Number);
      const actor = global.$gameParty.members().find((candidate) => candidate.actorId() === actorId);
      if (!actor || typeof actor.addState !== "function" ||
        typeof actor.removeState !== "function") throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
      if (value) actor.addState(stateId);
      else actor.removeState(stateId);
    } else if (body.category === "classes" || body.category.startsWith("classes:")) {
      if (value !== true) throw new Error("RPG_GAME_EDITOR_INVALID");
      const [actorId, classId] = body.id.split(":").map(Number);
      const actor = global.$gameParty.members().find((candidate) => candidate.actorId() === actorId);
      if (!actor || typeof actor.changeClass !== "function") throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
      actor.changeClass(classId, true);
    } else if (body.category === "party") {
      const actorId = Number(body.id);
      const members = editorPartyMembers();
      const position = members.findIndex((actor) => actor.actorId() === actorId);
      if (position < 0 && value === members.length + 1 &&
        typeof global.$gameParty.addActor === "function") global.$gameParty.addActor(actorId);
      else if (position >= 0 && value === 0 && members.length > 1 &&
        typeof global.$gameParty.removeActor === "function") global.$gameParty.removeActor(actorId);
      else if (position >= 0 && value >= 1 && Math.abs(value - position - 1) === 1 &&
        typeof global.$gameParty.swapOrder === "function") global.$gameParty.swapOrder(position, value - 1);
      else throw new Error("RPG_GAME_EDITOR_INVALID");
    } else {
      const [actorId, field] = body.id.split(":");
      const actor = global.$gameParty.members().find((candidate) => candidate.actorId() === Number(actorId));
      if (!actor) throw new Error("RPG_GAME_EDITOR_INVALID");
      const parameter = ACTOR_FIELDS.findIndex(([candidate]) => candidate === field) - 5;
      if (parameter >= 0) actor.addParam(parameter, value - actor.param(parameter));
      else if (field === "hp") actor.setHp(value);
      else if (field === "mp") actor.setMp(value);
      else if (field === "tp") actor.setTp(value);
      else if (field === "level") actor.changeLevel(value, false);
      else if (field === "exp") actor.changeExp(value, false);
      else throw new Error("RPG_GAME_EDITOR_INVALID");
    }
    const updated = editorRows(body.category).find((row) => row.id === body.id);
    if (!updated || (["states", "classes", "party"].some((category) =>
      body.category === category || body.category.startsWith(`${category}:`)) && updated.value !== value)) {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    return {entry: updated};
  }

  // Optional diagnostics observe engine-bound events; they never poll or synthesize inputs.
  function startInputDiagnostics() {
    let active = true;
    let sequence = 0;
    let dropped = 0;
    let events = [];
    const held = new Map();
    const values = new Map();
    const removers = [];
    const record = (device, control, value, target, stage) => {
      if (!active) return;
      const key = `${device}:${control}`;
      if ((values.get(key) || 0) === value) return;
      const previous = held.get(key);
      if (value === 0) values.delete(key);
      else if (values.size < 128) values.set(key, value);
      else { dropped++; return; }
      const atMs = global.performance.now();
      const observation = {sequence: ++sequence, atMs, device, control, value, target, stage,
        reason: null, heldMs: !value && previous ? atMs - previous.atMs : null};
      if (value === 0) held.delete(key);
      else if (!previous) held.set(key, observation);
      events.push(observation);
      if (events.length > 64) { events.shift(); dropped++; }
    };
    const keyEvent = (event) => {
      if (event.repeat || !event.code) return;
      record("keyboard", event.code.slice(0, 40), event.type === "keydown" ? 1 : 0,
        null, "BROWSER");
    };
    const reset = () => {held.clear(); values.clear();};
    global.addEventListener("keydown", keyEvent, {capture: true, passive: true});
    global.addEventListener("keyup", keyEvent, {capture: true, passive: true});
    global.addEventListener("blur", reset);
    removers.push(() => {
      global.removeEventListener("keydown", keyEvent, true);
      global.removeEventListener("keyup", keyEvent, true);
      global.removeEventListener("blur", reset);
    });
    const input = global.Input;
    let gamepad = false;
    if (input && typeof input._updateGamepadState === "function") {
      const original = input._updateGamepadState;
      const observed = function (pad) {
        const result = original.call(this, pad);
        try {
          if (pad && pad.buttons) for (let index = 0; index < Math.min(32, pad.buttons.length); index++) {
            record(`gamepad:${pad.index}`, `Button ${index}`, pad.buttons[index].pressed ? 1 : 0,
              typeof this.gamepadMapper[index] === "string" ? this.gamepadMapper[index] : null, "DELIVERED");
          }
        } catch { /* Diagnostics cannot interrupt engine input. */ }
        return result;
      };
      try {
        input._updateGamepadState = observed;
        removers.push(() => {if (input._updateGamepadState === observed) input._updateGamepadState = original;});
        gamepad = true;
      } catch { /* Frozen engine input remains playable without diagnostics. */ }
    }
    return {
      read: () => ({events, held: [...held.values()], dropped, keyboard: true, gamepad, delivery: gamepad,
        focus: global.document.hasFocus() ? "GAME" : "UNFOCUSED", coreRead: false}),
      clear: () => {events = []; dropped = 0;},
      stop: () => {active = false; for (const remove of removers.reverse()) {try {remove();} catch { /* Keep later owners. */ }}},
    };
  }

  async function dispatch(message) {
    switch (message.type) {
    case "STATUS": return { type: "STATUS_RESULT", body: { ready: readyForCheckpoint(), frameCount,
      ...(inputDiagnostics ? {inputDiagnostics: inputDiagnostics.read()} : {}) } };
    case "INPUT_DIAGNOSTICS":
      if (typeof message.body.enabled !== "boolean") throw new Error("RPG_NATIVE_MESSAGE_INVALID");
      if (inputDiagnostics) inputDiagnostics.stop();
      inputDiagnostics = message.body.enabled ? startInputDiagnostics() : null;
      return {type: "INPUT_DIAGNOSTICS_RESULT", body: {}};
    case "CLEAR_INPUT_DIAGNOSTICS":
      if (inputDiagnostics) inputDiagnostics.clear();
      return {type: "CLEAR_INPUT_DIAGNOSTICS_RESULT", body: {}};
    case "SAVE": return { type: "SAVE_RESULT", body: await captureNativeSave() };
    case "RESTORE": return { type: "RESTORE_RESULT", body: await restoreNativeSave(message.body.bundle) };
    case "SCREENSHOT": return { type: "SCREENSHOT_RESULT", body: await screenshot() };
    case "PAUSE": setPaused(true); return { type: "PAUSE_RESULT", body: {} };
    case "RESUME": setPaused(false); return { type: "RESUME_RESULT", body: {} };
    case "SET_VIDEO_MODE": setVideoMode(message.body.mode); return { type: "SET_VIDEO_MODE_RESULT", body: {} };
    case "SET_VOLUME": setVolume(message.body.value); return { type: "SET_VOLUME_RESULT", body: {} };
    case "EDITOR_CATEGORIES": return {type: "EDITOR_CATEGORIES_RESULT",
      body: {categories: EDITOR_CATEGORIES.map((category) =>
        ["actors", "skills", "states", "classes"].includes(category.id)
        ? {...category, groups: editorPartyGroups(category.id,
          {skills: "isLearnedSkill", states: "isStateAffected", classes: "currentClass"}[category.id] || null)}
        : {...category})}};
    case "EDITOR_ENTRIES": return {type: "EDITOR_ENTRIES_RESULT", body: editorList(message.body)};
    case "EDITOR_SET": return {type: "EDITOR_SET_RESULT", body: editorSet(message.body)};
    case "CLEANUP":
      if (inputDiagnostics) inputDiagnostics.stop();
      inputDiagnostics = null;
      if (cleanupUrl) {
        void global.fetch(cleanupUrl, { method: "POST", credentials: "same-origin", keepalive: true })
          .catch(() => undefined);
      }
      return { type: "CLEANUP_RESULT", body: {} };
    default: throw new Error("RPG_NATIVE_MESSAGE_INVALID");
    }
  }

  async function receive(message) {
    if (!ownKeys(message, ["body", "launchId", "nonce", "protocolVersion", "requestId", "type"]) ||
      message.protocolVersion !== PROTOCOL_VERSION || message.launchId !== launchId || message.nonce !== nonce ||
      !Number.isSafeInteger(message.requestId) || message.requestId !== lastRequestId + 1 ||
      typeof message.type !== "string" || !ownKeys(message.body, Object.keys(message.body || {}).sort()) || requestPending ||
      encoder.encode(JSON.stringify(message)).byteLength > MAX_CONTROL_BYTES) {
      return;
    }
    lastRequestId = message.requestId;
    requestPending = true;
    try {
      const result = await dispatch(message);
      const transfers = [];
      if (result.type === "SAVE_RESULT") result.body.bundle.entries.forEach((entry) => transfers.push(entry.data));
      if (result.type === "SCREENSHOT_RESULT") transfers.push(result.body.data);
      send(message.requestId, result.type, result.body, transfers);
    } catch (error) {
      send(message.requestId, "ERROR", { code: error && error.message || "RPG_NATIVE_RUNTIME_FAILED" });
    } finally {
      requestPending = false;
    }
  }

  function observeFrame() {
    frameCount += 1;
    if (!engineReadySent && engineRuntimeReady()) {
      engineReadySent = true;
      event("READY", { engine: engine(), engineProfile: profile });
    }
  }

  function requestExit() {
    if (exitRequested) return;
    exitRequested = true;
    event("EXIT_REQUESTED", {});
  }

  function installSceneManagerHook() {
    const manager = global.SceneManager;
    if (sceneManagerHooked || !manager || typeof manager.updateMain !== "function") return;
    const original = manager.updateMain;
    const originalExit = manager.exit;
    manager.updateMain = function runtimeUpdateMain() {
      const result = original.apply(this, arguments);
      observeFrame();
      return result;
    };
    if (typeof originalExit === "function") {
      manager.exit = function runtimeExit() {
        requestExit();
        return originalExit.apply(this, arguments);
      };
    }
    sceneManagerHooked = true;
  }

  function pollForEngine() {
    installSceneManagerHook();
    if (!sceneManagerHooked) global.requestAnimationFrame(pollForEngine);
  }

  function installCanvasTextAlignCompatibility() {
    const prototype = global.CanvasRenderingContext2D && global.CanvasRenderingContext2D.prototype;
    if (!prototype) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "textAlign");
    if (!descriptor || !descriptor.configurable || typeof descriptor.get !== "function" ||
      typeof descriptor.set !== "function") return;
    const valid = new Set(["start", "end", "left", "right", "center"]);
    Object.defineProperty(prototype, "textAlign", {
      ...descriptor,
      set: function runtimeTextAlign(value) {
        if (valid.has(value)) descriptor.set.call(this, value);
      },
    });
  }

  installCanvasTextAlignCompatibility();

  global.addEventListener("message", function connect(eventMessage) {
    const message = eventMessage.data;
    const validatedCleanupUrl = readCleanupUrl(message && message.cleanupUrl);
    if (!ownKeys(message, ["cleanupUrl", "launchId", "nonce", "parentOrigin", "profile", "protocolVersion", "type"]) ||
      message.type !== "RPG_RUNTIME_NATIVE_CONNECT" || message.protocolVersion !== PROTOCOL_VERSION ||
      typeof message.launchId !== "string" || typeof message.nonce !== "string" ||
      typeof message.parentOrigin !== "string" || eventMessage.origin !== message.parentOrigin ||
      (message.profile !== "RPGMV" && message.profile !== "RPGMZ") || validatedCleanupUrl === undefined ||
      eventMessage.ports.length !== 1 || port) {
      return;
    }
    eventMessage.stopImmediatePropagation();
    launchId = message.launchId;
    nonce = message.nonce;
    parentOrigin = message.parentOrigin;
    profile = message.profile;
    cleanupUrl = validatedCleanupUrl;
    port = eventMessage.ports[0];
    port.onmessage = (portEvent) => { void receive(portEvent.data); };
    port.start();
    pollForEngine();
  }, true);

  global.parent.postMessage({ type: "RPG_RUNTIME_NATIVE_BRIDGE_READY", protocolVersion: PROTOCOL_VERSION }, "*");
  global.__RPG_RUNTIME_NATIVE_BRIDGE__ = Object.freeze({ protocolVersion: PROTOCOL_VERSION });
})(window);
