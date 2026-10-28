import {createRpgPluginFiles, isPluginSavePath} from "../../../src/native-web/plugin-files.ts";

export function installRpgRuntimeNativeBridge(global, inputFilter) {
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
    {id: "party", label: "队伍成员"}, {id: "self_switches", label: "事件独立开关"},
  ]);
  const SELF_SWITCH_KEYS = Object.freeze(["A", "B", "C", "D"]);
  const ACTOR_FIELDS = Object.freeze([
    ["hp", "生命"], ["mp", "魔法"], ["tp", "TP"], ["level", "等级"], ["exp", "经验"],
    ["mhp", "最大生命"], ["mmp", "最大魔法"], ["atk", "攻击"],
    ["def", "防御"], ["mat", "魔法攻击"], ["mdf", "魔法防御"],
    ["agi", "敏捷"], ["luk", "幸运"],
  ]);
  inputFilter.onHostShortcut(shortcut => event("HOST_SHORTCUT", {shortcut}));
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let launchId = null;
  let nonce = null;
  let parentOrigin = null;
  let port = null;
  let profile = null;
  let lastRequestId = 0;
  let requestPending = false;
  let frameCount = 0;
  let engineReadySent = false;
  let sceneManagerHooked = false;
  let exitRequested = false;
  let bootCompleted = false;
  let titleStarted = false;
  let closed = false;
  let pluginFiles = null;
  let inputDiagnostics = null;
  let restoreViewport = null;
  const editorMapCache = new Map();

  function ownKeys(value, expected) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
    if (profile === "RPGMV" && pluginFiles) {
      for (const file of pluginFiles.snapshot()) entries.push({
        store: "FILESYSTEM", key: file.path, mediaType: "application/octet-stream", data: file.data,
      });
    }
    return { bundle: { engine: engine(), resumeSlot: slot, entries } };
  }

  function validateRestoreBundle(bundle) {
    if (!bundle || bundle.engine !== engine() || !Number.isSafeInteger(bundle.resumeSlot) ||
      bundle.resumeSlot < 1 || !Array.isArray(bundle.entries) || bundle.entries.length < 1 || bundle.entries.length > 130) {
      throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
    }
    const allowed = new Set(storageNames(bundle.resumeSlot));
    const expectedStore = profile === "RPGMZ" ? "LOCALFORAGE" : "LOCAL_STORAGE";
    const entries = new Map();
    const files = [];
    const fileKeys = new Set();
    let totalBytes = 0;
    for (const entry of bundle.entries) {
      if (!ownKeys(entry, ["data", "key", "mediaType", "store"]) ||
        typeof entry.key !== "string" || entry.mediaType !== "application/octet-stream" ||
        !(entry.data instanceof ArrayBuffer) || entry.data.byteLength > MAX_ENTRY_BYTES) {
        throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
      }
      totalBytes += entry.data.byteLength;
      if (totalBytes > MAX_ENTRY_BYTES) throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
      if (profile === "RPGMV" && entry.store === "FILESYSTEM" && isPluginSavePath(entry.key) && !fileKeys.has(entry.key)) {
        fileKeys.add(entry.key);
        files.push({path: entry.key, data: entry.data});
      } else if (entry.store === expectedStore && allowed.has(entry.key) && !entries.has(entry.key) && entry.data.byteLength) {
        entries.set(entry.key, new Uint8Array(entry.data));
      } else throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
    }
    if (!entries.has(storageNames(bundle.resumeSlot)[1])) throw new Error("RPG_CHECKPOINT_RESTORE_INVALID");
    return { slot: bundle.resumeSlot, entries, files };
  }

  async function restoreNativeSave(bundle) {
    const validated = validateRestoreBundle(bundle);
    const deadline = performance.now() + 30000;
    const releaseInput = suppressRestoreInput();
    try {
      if (!global.DataManager || typeof global.DataManager.isDatabaseLoaded !== "function") {
        throw new Error("RPG_CHECKPOINT_DATABASE_UNAVAILABLE");
      }
      await waitForRestore(() => global.DataManager.isDatabaseLoaded(), deadline, "RPG_CHECKPOINT_DATABASE_TIMEOUT");
      await waitForRestore(() => bootCompleted, deadline);
      await prepareRestoreTitle(deadline);
      return await loadNativeSave(validated, deadline);
    } finally {
      releaseInput();
    }
  }

  function suppressRestoreInput() {
    const restorers = [];
    for (const input of [global.Input, global.TouchInput]) {
      if (!input || typeof input.clear !== "function") continue;
      input.clear();
      replaceMethod(input, "update", () => function restoreInputUpdate() { this.clear(); }, restorers);
      restorers.push(() => input.clear());
    }
    return () => restorers.reverse().forEach(restore => restore());
  }

  async function prepareRestoreTitle(deadline) {
    const manager = global.SceneManager;
    const title = global.Scene_Title;
    if (typeof title !== "function") throw new Error("RPG_CHECKPOINT_RESTORE_UNSUPPORTED");
    // Boot plugins may enter an opening map. Let the actual title lifecycle finish
    // their transient state before loading game objects, including custom title hooks.
    // Finish fades too: restored game globals may change a transition plugin's mode.
    if (!titleStarted && !(manager._scene instanceof title) && !(manager._nextScene instanceof title)) {
      manager.goto(title);
    }
    await waitForRestore(() => titleStarted && !manager.isSceneChanging() &&
      isCurrentSceneStarted() && !manager.isCurrentSceneBusy(), deadline);
  }

  function isCurrentSceneStarted() {
    const manager = global.SceneManager;
    // MV owns this state on SceneManager; MZ moved it onto Scene_Base.
    if (typeof manager.isCurrentSceneStarted === "function") return manager.isCurrentSceneStarted();
    const scene = manager._scene;
    return !!scene && typeof scene.isStarted === "function" && scene.isStarted();
  }

  async function loadNativeSave(validated, deadline) {
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
    const previousFiles = pluginFiles && pluginFiles.snapshot();
    try {
      if (pluginFiles) pluginFiles.restore(validated.files);
      const loaded = await global.DataManager.loadGame(validated.slot);
      if (loaded === false) throw new Error("RPG_CHECKPOINT_RESTORE_FAILED");
      if (closed) throw new Error("RPG_NATIVE_CHANNEL_CLOSED");
      if (performance.now() >= deadline) throw new Error("RPG_CHECKPOINT_RESTORE_TIMEOUT");
      if (global.SceneManager && global.Scene_Map) global.SceneManager.goto(global.Scene_Map);
      runGameSystemHook("onAfterLoad");
      await waitForMap(deadline);
    } catch (error) {
      if (pluginFiles && previousFiles) pluginFiles.restore(previousFiles);
      throw error;
    } finally {
      restorers.reverse().forEach((restore) => restore());
    }
    return {};
  }

  function waitForRestore(ready, deadline, timeoutCode = "RPG_CHECKPOINT_RESTORE_TIMEOUT") {
    return new Promise((resolve, reject) => {
      function poll() {
        try {
          if (closed) throw new Error("RPG_NATIVE_CHANNEL_CLOSED");
          if (performance.now() >= deadline) throw new Error(timeoutCode);
          if (ready()) { resolve(); return; }
          global.requestAnimationFrame(poll);
        } catch (error) {
          reject(error);
        }
      }
      poll();
    });
  }

  function waitForMap(deadline) {
    return waitForRestore(() => isCurrentSceneStarted() && readyForCheckpoint(), deadline);
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

  function editorRowsForActors(source, selectedActorId, requiredMethod, rows) {
    const party = global.$gameParty;
    if (typeof party.members !== "function" || !Array.isArray(source)) {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    return party.members().flatMap((actor) => {
      if (!actor || typeof actor.actorId !== "function" ||
        typeof actor[requiredMethod] !== "function") return [];
      const actorId = actor.actorId();
      if (!Number.isSafeInteger(actorId) || actorId < 1 ||
        selectedActorId !== null && actorId !== selectedActorId) return [];
      const actorName = typeof actor.name === "function" ? actor.name() : `角色 ${actorId}`;
      return rows(actor, actorId, actorName);
    });
  }

  function editorSkillRows(selectedActorId = null) {
    const source = global.$dataSkills;
    return editorRowsForActors(source, selectedActorId, "isLearnedSkill", (actor, actorId, actorName) => {
      const skills = source.slice(1).filter((skill) => skill && Number.isSafeInteger(skill.id) &&
        skill.id > 0 && String(skill.name || "").trim());
      return skills.map((skill) => editorEntry(`${actorId}:${skill.id}`,
        selectedActorId === null ? `${actorName} · ${String(skill.name).trim()}` : String(skill.name).trim(),
        Boolean(actor.isLearnedSkill(skill.id))));
    });
  }

  function editorStateRows(selectedActorId = null) {
    const source = global.$dataStates;
    return editorRowsForActors(source, selectedActorId, "isStateAffected", (actor, actorId, actorName) => {
      const deathStateId = typeof actor.deathStateId === "function" ? actor.deathStateId() : 1;
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
    const source = global.$dataClasses;
    return editorRowsForActors(source, selectedActorId, "currentClass", (actor, actorId, actorName) => {
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

  function editorPageRequest(body, withMap) {
    if (!body || typeof body.query !== "string" || body.query.length > 80 ||
      !Number.isSafeInteger(body.offset) || body.offset < 0 ||
      !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 40 ||
      withMap && !editorMapInfo(body.mapId)) throw new Error("RPG_GAME_EDITOR_INVALID");
    return body.query.trim().toLowerCase();
  }

  function editorMapInfo(mapId) {
    const infos = global.$dataMapInfos;
    return Number.isSafeInteger(mapId) && mapId > 0 && Array.isArray(infos) &&
      infos[mapId] && infos[mapId].id === mapId ? infos[mapId] : null;
  }

  function editorMapLabel(info) {
    return String(info.name || "").trim().slice(0, 160) || `地图 ${info.id}`;
  }

  function editorMapPage(body) {
    if (!editorReady()) throw new Error("RPG_GAME_EDITOR_NOT_READY");
    const query = editorPageRequest(body, false);
    const currentMapId = global.$gameMap.mapId();
    const current = editorMapInfo(currentMapId);
    if (!current) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    const maps = global.$dataMapInfos.slice(1).filter((info) => info && editorMapInfo(info.id))
      .map((info) => ({id: info.id, label: editorMapLabel(info)}))
      .filter((map) => !query || map.label.toLowerCase().includes(query) || String(map.id).includes(query));
    return {currentMapId, currentMapName: editorMapLabel(current),
      maps: maps.slice(body.offset, body.offset + body.limit),
      nextOffset: body.offset + body.limit < maps.length ? body.offset + body.limit : null};
  }

  async function editorMapData(mapId) {
    if (!editorMapInfo(mapId)) throw new Error("RPG_GAME_EDITOR_INVALID");
    if (global.$gameMap.mapId() === mapId && Array.isArray(global.$dataMap && global.$dataMap.events)) {
      return global.$dataMap;
    }
    if (editorMapCache.has(mapId)) return editorMapCache.get(mapId);
    const path = `data/Map${String(mapId).padStart(3, "0")}.json`;
    const response = await global.fetch(path, {credentials: "same-origin"});
    if (!response.ok) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    const data = await response.json();
    if (!data || !Array.isArray(data.events)) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    if (editorMapCache.size >= 3) editorMapCache.delete(editorMapCache.keys().next().value);
    editorMapCache.set(mapId, data);
    return data;
  }

  function editorEventRow(mapId, event) {
    const id = event.id;
    const switches = {};
    for (const key of SELF_SWITCH_KEYS) {
      switches[key] = Boolean(global.$gameSelfSwitches.value([mapId, id, key]));
    }
    const pageUses = (Array.isArray(event.pages) ? event.pages : []).flatMap((page, index) => {
      const conditions = page && page.conditions;
      return conditions && conditions.selfSwitchValid && SELF_SWITCH_KEYS.includes(conditions.selfSwitchCh)
        ? [{key: conditions.selfSwitchCh, page: index + 1, summary: editorPageSummary(page)}] : [];
    });
    return {id, label: String(event.name || "").trim().slice(0, 160) || `事件 ${id}`,
      x: Number.isSafeInteger(event.x) ? event.x : 0,
      y: Number.isSafeInteger(event.y) ? event.y : 0, switches, pageUses};
  }

  function editorPageSummary(page) {
    const commands = (Array.isArray(page.list) ? page.list : []).filter((command) => command && command.code > 0);
    const firstText = commands.find((command) => (command.code === 401 || command.code === 405) &&
      typeof command.parameters?.[0] === "string");
    const text = firstText && firstText.parameters[0].replace(/\s+/gu, " ").trim();
    if (text) return `首句：${text.slice(0, 100)}`;
    const hasImage = Boolean(page.image && (page.image.tileId > 0 || page.image.characterName));
    if (!commands.length) return hasImage ? "有图像，无事件指令" : "无图像、无事件指令";
    return hasImage ? "有图像和事件指令" : "无图像，有事件指令";
  }

  async function editorEventRows(mapId) {
    if (!global.$gameSelfSwitches || typeof global.$gameSelfSwitches.value !== "function") {
      throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    }
    const data = await editorMapData(mapId);
    return data.events.slice(1).flatMap((event, index) => {
      if (!event || event.id !== index + 1) return [];
      const row = editorEventRow(mapId, event);
      return row.pageUses.length ? [row] : [];
    });
  }

  async function editorEventPage(body) {
    if (!editorReady()) throw new Error("RPG_GAME_EDITOR_NOT_READY");
    const query = editorPageRequest(body, true);
    const rows = (await editorEventRows(body.mapId)).filter((event) =>
      !query || event.label.toLowerCase().includes(query) || String(event.id).includes(query));
    return {events: rows.slice(body.offset, body.offset + body.limit),
      nextOffset: body.offset + body.limit < rows.length ? body.offset + body.limit : null};
  }

  async function editorSetSelfSwitch(body) {
    if (!editorReady()) throw new Error("RPG_GAME_EDITOR_NOT_READY");
    if (!body || !editorMapInfo(body.mapId) || !Number.isSafeInteger(body.eventId) || body.eventId < 1 ||
      !SELF_SWITCH_KEYS.includes(body.key) || typeof body.value !== "boolean" ||
      typeof global.$gameSelfSwitches?.setValue !== "function") throw new Error("RPG_GAME_EDITOR_INVALID");
    const rows = await editorEventRows(body.mapId);
    const event = rows.find((row) => row.id === body.eventId);
    if (!event || !event.pageUses.some((use) => use.key === body.key)) throw new Error("RPG_GAME_EDITOR_INVALID");
    global.$gameSelfSwitches.setValue([body.mapId, body.eventId, body.key], body.value);
    const actual = (await editorEventRows(body.mapId)).find((row) => row.id === body.eventId);
    if (actual.switches[body.key] !== body.value) throw new Error("RPG_GAME_EDITOR_UNAVAILABLE");
    return {event: actual};
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
    case "SET_HOST_SHORTCUT_POLICY":
      if (!ownKeys(message.body, ["policy"])) {throw new Error("PLAYER_HOST_SHORTCUT_POLICY_INVALID");}
      inputFilter.setHostShortcutPolicy(message.body.policy);
      return {type: "SET_HOST_SHORTCUT_POLICY_RESULT", body: {}};
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
    case "PAUSE": inputFilter.setPaused(true); setPaused(true); return { type: "PAUSE_RESULT", body: {} };
    case "RESUME": setPaused(false); inputFilter.setPaused(false); return { type: "RESUME_RESULT", body: {} };
    case "SET_TOUCH_GAMEPAD":
      if (!ownKeys(message.body, ["enabled"]) || typeof message.body.enabled !== "boolean") throw new Error("RPG_NATIVE_MESSAGE_INVALID");
      await inputFilter.setTouchGamepadEnabled(message.body.enabled);
      return {type: "SET_TOUCH_GAMEPAD_RESULT", body: {}};
    case "SET_VIDEO_MODE": setVideoMode(message.body.mode); return { type: "SET_VIDEO_MODE_RESULT", body: {} };
    case "SET_INPUT_FILTER":
      if (!ownKeys(message.body, ["policy"])) throw new Error("RPG_NATIVE_MESSAGE_INVALID");
      inputFilter.set(message.body.policy); return {type: "SET_INPUT_FILTER_RESULT", body: {}};
    case "SET_VOLUME": setVolume(message.body.value); return { type: "SET_VOLUME_RESULT", body: {} };
    case "EDITOR_CATEGORIES": return {type: "EDITOR_CATEGORIES_RESULT",
      body: {categories: EDITOR_CATEGORIES.map((category) =>
        ["actors", "skills", "states", "classes"].includes(category.id)
        ? {...category, groups: editorPartyGroups(category.id,
          {skills: "isLearnedSkill", states: "isStateAffected", classes: "currentClass"}[category.id] || null)}
        : {...category})}};
    case "EDITOR_ENTRIES": return {type: "EDITOR_ENTRIES_RESULT", body: editorList(message.body)};
    case "EDITOR_SET": return {type: "EDITOR_SET_RESULT", body: editorSet(message.body)};
    case "EDITOR_SELF_SWITCH_MAPS": return {type: "EDITOR_SELF_SWITCH_MAPS_RESULT", body: editorMapPage(message.body)};
    case "EDITOR_SELF_SWITCH_EVENTS": return {type: "EDITOR_SELF_SWITCH_EVENTS_RESULT", body: await editorEventPage(message.body)};
    case "EDITOR_SELF_SWITCH_SET": return {type: "EDITOR_SELF_SWITCH_SET_RESULT", body: await editorSetSelfSwitch(message.body)};
    case "CLEANUP":
      closed = true;
      if (restoreViewport) restoreViewport();
      if (pluginFiles) pluginFiles.close();
      inputFilter.stop();
      if (inputDiagnostics) inputDiagnostics.stop();
      inputDiagnostics = null;
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

  function installViewportFit() {
    const graphics = global.Graphics;
    if (!graphics || typeof graphics._defaultStretchMode !== "function") return;
    const defaultStretchMode = graphics._defaultStretchMode;
    const stretchEnabled = graphics._stretchEnabled;
    const fitViewport = () => true;
    // Use the engine's scaling so canvas, video and pointer coordinates stay aligned.
    graphics._defaultStretchMode = fitViewport;
    if (graphics._canvas) {
      graphics._stretchEnabled = true;
      graphics._updateAllElements();
    }
    restoreViewport = function restoreViewportFit() {
      if (graphics._defaultStretchMode !== fitViewport) return;
      graphics._defaultStretchMode = defaultStretchMode;
      graphics._stretchEnabled = stretchEnabled;
      if (graphics._canvas) graphics._updateAllElements();
    };
  }

  function installDesktopCompatibility(bootPrototype) {
    const isReady = bootPrototype.isReady;
    if (typeof isReady === "function") bootPrototype.isReady = function runtimeBootReady() {
      return Boolean(pluginFiles) && isReady.apply(this, arguments);
    };
    global.require = function requirePluginModule(name) {
      if (name !== "fs") throw new Error("RPG_PLUGIN_MODULE_UNSUPPORTED");
      if (!pluginFiles) throw new Error("RPG_PLUGIN_FILES_NOT_READY");
      return pluginFiles.fs;
    };
    global.StorageManager.localFileDirectoryPath = () => pluginFiles.saveDirectory;
    const manager = global.DataManager;
    if (typeof manager.makeSavefileInfo === "function") {
      const makeInfo = manager.makeSavefileInfo;
      manager.makeSavefileInfo = function runtimeSavefileInfo() {
        const info = makeInfo.apply(this, arguments);
        return {...info, runtimeGameTitle: global.$dataSystem.gameTitle};
      };
    }
    if (typeof manager.isThisGameFile === "function") {
      const isThisGameFile = manager.isThisGameFile;
      manager.isThisGameFile = function runtimeIsThisGameFile(id) {
        const info = this.loadGlobalInfo()[id];
        if (!info || !Object.hasOwn(info, "runtimeGameTitle")) return isThisGameFile.apply(this, arguments);
        if (info.runtimeGameTitle !== global.$dataSystem.gameTitle) return false;
        const loadInfo = this.loadGlobalInfo;
        // Keep plugin display text and all original engine/plugin identity checks.
        this.loadGlobalInfo = function runtimeIdentityInfo() {
          const result = loadInfo.apply(this, arguments).slice();
          result[id] = {...result[id], title: info.runtimeGameTitle};
          return result;
        };
        try { return isThisGameFile.apply(this, arguments); }
        finally { this.loadGlobalInfo = loadInfo; }
      };
    }
  }

  installCanvasTextAlignCompatibility();
  // Install after plugins have wrapped Boot.start, before the game's window.onload runs it.
  global.addEventListener("load", function prepareEngine(event) {
    if (event.target !== global.document) return;
    installViewportFit();
    const prototype = global.Scene_Boot && global.Scene_Boot.prototype;
    if (!prototype || typeof prototype.start !== "function") return;
    if (global.Utils && global.Utils.RPGMAKER_NAME === "MV") installDesktopCompatibility(prototype);
    const start = prototype.start;
    prototype.start = function runtimeBootStart() {
      const result = start.apply(this, arguments);
      bootCompleted = true;
      return result;
    };
    const title = global.Scene_Title && global.Scene_Title.prototype;
    if (title && typeof title.start === "function") {
      const startTitle = title.start;
      title.start = function runtimeTitleStart() {
        const result = startTitle.apply(this, arguments);
        titleStarted = true;
        return result;
      };
    }
  }, true);
  global.addEventListener("pagehide", () => {
    closed = true;
    if (restoreViewport) restoreViewport();
  }, {once: true});

  global.addEventListener("message", function connect(eventMessage) {
    const message = eventMessage.data;
    if (eventMessage.source !== global.parent || !ownKeys(message, ["launchId", "nonce", "parentOrigin", "pluginFiles", "profile", "protocolVersion", "type"]) ||
      message.type !== "RPG_RUNTIME_NATIVE_CONNECT" || message.protocolVersion !== PROTOCOL_VERSION ||
      typeof message.launchId !== "string" || typeof message.nonce !== "string" ||
      typeof message.parentOrigin !== "string" || eventMessage.origin !== message.parentOrigin ||
      (message.profile !== "RPGMV" && message.profile !== "RPGMZ") ||
      eventMessage.ports.length !== 1 || port) {
      return;
    }
    eventMessage.stopImmediatePropagation();
    launchId = message.launchId;
    nonce = message.nonce;
    parentOrigin = message.parentOrigin;
    profile = message.profile;
    port = eventMessage.ports[0];
    port.onmessage = (portEvent) => { void receive(portEvent.data); };
    port.start();
    if (profile === "RPGMV") {
      try { pluginFiles = createRpgPluginFiles(global.location.href, message.pluginFiles); }
      catch (error) { event("ERROR", {code: error.message}); return; }
    }
    pollForEngine();
  }, true);

  global.parent.postMessage({ type: "RPG_RUNTIME_NATIVE_BRIDGE_READY", protocolVersion: PROTOCOL_VERSION }, "*");
  global.__RPG_RUNTIME_NATIVE_BRIDGE__ = Object.freeze({ protocolVersion: PROTOCOL_VERSION });
}
