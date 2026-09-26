import type {RuntimeGameEditEntryV1, RuntimeGameEditEventV1, RuntimeGameEditMapV1,
  RuntimeGameEditSelfSwitchKeyV1, RuntimeGameEditorV1} from "../provider/module-api.js";
import type {NativeChannel} from "./adapter.js";

type EditorChannel = Pick<NativeChannel, "request">;
const token = /^[a-z0-9:_-]{1,60}$/u;

export function createNativeGameEditor(channel: EditorChannel): RuntimeGameEditorV1 {
  return {
    async categories() {
      const reply = await channel.request("EDITOR_CATEGORIES", {});
      if (reply.type !== "EDITOR_CATEGORIES_RESULT" || !Array.isArray(reply.body.categories) ||
        reply.body.categories.length > 16) {throw invalid();}
      return reply.body.categories.map((raw) => {
        if (!record(raw) || typeof raw.id !== "string" || !token.test(raw.id) || !label(raw.label, 40)) {throw invalid();}
        if (raw.groups === undefined) {return {id: raw.id, label: raw.label};}
        if (!Array.isArray(raw.groups) || raw.groups.length > 64) {throw invalid();}
        const groups = raw.groups.map((group) => {
          if (!record(group) || typeof group.id !== "string" || !token.test(group.id) ||
            !group.id.startsWith(`${raw.id}:`) || !label(group.label, 160)) {throw invalid();}
          return {id: group.id, label: group.label};
        });
        if (new Set(groups.map((group) => group.id)).size !== groups.length) {throw invalid();}
        return {id: raw.id, label: raw.label, groups};
      });
    },
    async entries(category, query, offset, limit) {
      if (!token.test(category) || query.length > 80 || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 40) {throw invalid();}
      const reply = await channel.request("EDITOR_ENTRIES", {category, query, offset, limit});
      if (reply.type !== "EDITOR_ENTRIES_RESULT" || !Array.isArray(reply.body.entries) ||
        reply.body.entries.length > limit) {throw invalid();}
      const next = reply.body.nextOffset;
      if (next !== null && (!Number.isSafeInteger(next) || Number(next) <= offset)) {throw invalid();}
      return {entries: reply.body.entries.map(readEntry), nextOffset: next as number | null};
    },
    async set(category, id, value) {
      if (!token.test(category) || !token.test(id) || !scalar(value)) {throw invalid();}
      const reply = await channel.request("EDITOR_SET", {category, id, value});
      if (reply.type !== "EDITOR_SET_RESULT") {throw invalid();}
      return readEntry(reply.body.entry);
    },
    selfSwitches: {
      async maps(query, offset, limit) {
        pageRequest(query, offset, limit);
        const reply = await channel.request("EDITOR_SELF_SWITCH_MAPS", {query, offset, limit});
        const body = reply.body;
        if (reply.type !== "EDITOR_SELF_SWITCH_MAPS_RESULT" || !positiveId(body.currentMapId) ||
          !label(body.currentMapName, 160) || !Array.isArray(body.maps) || body.maps.length > limit) {throw invalid();}
        const maps = body.maps.map(readMap);
        return {currentMapId: body.currentMapId, currentMapName: body.currentMapName,
          maps, nextOffset: readNext(body.nextOffset, offset)};
      },
      async events(mapId, query, offset, limit) {
        if (!positiveId(mapId)) {throw invalid();}
        pageRequest(query, offset, limit);
        const reply = await channel.request("EDITOR_SELF_SWITCH_EVENTS", {mapId, query, offset, limit});
        if (reply.type !== "EDITOR_SELF_SWITCH_EVENTS_RESULT" || !Array.isArray(reply.body.events) ||
          reply.body.events.length > limit) {throw invalid();}
        return {events: reply.body.events.map(readEvent), nextOffset: readNext(reply.body.nextOffset, offset)};
      },
      async set(mapId, eventId, key, value) {
        if (!positiveId(mapId) || !positiveId(eventId) || !["A", "B", "C", "D"].includes(key) ||
          typeof value !== "boolean") {throw invalid();}
        const reply = await channel.request("EDITOR_SELF_SWITCH_SET", {mapId, eventId, key, value});
        if (reply.type !== "EDITOR_SELF_SWITCH_SET_RESULT") {throw invalid();}
        return readEvent(reply.body.event);
      },
    },
  };
}

function pageRequest(query: string, offset: number, limit: number) {
  if (query.length > 80 || !Number.isSafeInteger(offset) || offset < 0 ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > 40) {throw invalid();}
}

function readNext(raw: unknown, offset: number) {
  if (raw !== null && (!Number.isSafeInteger(raw) || Number(raw) <= offset)) {throw invalid();}
  return raw as number | null;
}

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readMap(raw: unknown): RuntimeGameEditMapV1 {
  if (!record(raw) || !positiveId(raw.id) || !label(raw.label, 160)) {throw invalid();}
  return {id: raw.id, label: raw.label};
}

function readEvent(raw: unknown): RuntimeGameEditEventV1 {
  if (!record(raw) || !positiveId(raw.id) || !label(raw.label, 160) ||
    !Number.isSafeInteger(raw.x) || !Number.isSafeInteger(raw.y) || !record(raw.switches) ||
    Object.keys(raw.switches).sort().join("") !== "ABCD" || !Array.isArray(raw.pageUses) ||
    !raw.pageUses.length) {throw invalid();}
  const keys: RuntimeGameEditSelfSwitchKeyV1[] = ["A", "B", "C", "D"];
  if (keys.some((key) => typeof (raw.switches as Record<string, unknown>)[key] !== "boolean")) {throw invalid();}
  if (raw.pageUses.some((use) => !record(use) || !keys.includes(use.key as RuntimeGameEditSelfSwitchKeyV1) ||
    !positiveId(use.page) || !label(use.summary, 160))) {throw invalid();}
  return raw as RuntimeGameEditEventV1;
}

function readEntry(raw: unknown): RuntimeGameEditEntryV1 {
  if (!record(raw) || typeof raw.id !== "string" || !token.test(raw.id) || !label(raw.label, 160) ||
    !["number", "text", "boolean", "unsupported"].includes(String(raw.valueType))) {throw invalid();}
  if (!validValue(raw.valueType, raw.value) || !validBounds(raw.valueType, raw.min, raw.max)) {throw invalid();}
  return raw as RuntimeGameEditEntryV1;
}

function validValue(kind: unknown, value: unknown) {
  if (kind === "number") {return typeof value === "number" && Number.isSafeInteger(value);}
  if (kind === "text") {return typeof value === "string" && value.length <= 500;}
  if (kind === "boolean") {return typeof value === "boolean";}
  return kind === "unsupported" && value === null;
}

function validBounds(kind: unknown, minimum: unknown, maximum: unknown) {
  if (kind !== "number") {return minimum === undefined && maximum === undefined;}
  return (minimum === undefined || typeof minimum === "number" && Number.isSafeInteger(minimum)) &&
    (maximum === undefined || typeof maximum === "number" && Number.isSafeInteger(maximum));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function label(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function scalar(value: unknown) {
  return typeof value === "boolean" || typeof value === "string" && value.length <= 500 ||
    typeof value === "number" && Number.isSafeInteger(value);
}

function invalid() {return new Error("RPG_GAME_EDITOR_INVALID");}
