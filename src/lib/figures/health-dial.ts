/**
 * The fixed Tabletop Simulator health dial supplied by Unmatched Labs.
 *
 * This is not the generated disc used by ordinary tokens. The model has three
 * disconnected shells: a two-inch portrait disc, a counter body, and a reset
 * tab. Its one portrait texture is a complete two-sided UV atlas, with the
 * front and back faces above and below a narrow strip used by the controls.
 * Preview and export code must therefore use this model and atlas together;
 * feeding either through the generic token pipeline produces the wrong shape
 * and UV layout.
 */
/** The sanitized TTS saved-object template. Export fills both asset URLs. */
export const HEALTH_DIAL_SAVE_URL = '/assets/templates/health dial.json';

/** The fixed mesh used by the editor preview. */
export const HEALTH_DIAL_MODEL_URL = '/assets/templates/health-dial.obj';

/** The mesh's bytes are pinned so an accidental replacement is detectable. */
export const HEALTH_DIAL_MODEL_SHA256 =
  'ae1977ddd1c9ce60b5ac2944a5099c4242dd0621355b62f3982193dd6207fded';

/** Where the fixed mesh belongs inside a generated TTS bundle. */
export const HEALTH_DIAL_MODEL_PATH = 'models/health-dial.obj';

/** Nominal Tabletop Simulator scale: one model unit is approximately an inch. */
export const HEALTH_DIAL_MM_PER_UNIT = 25.4;

/** Exact bounds measured from the vendored OBJ, in model/TTS units. */
export const HEALTH_DIAL_MODEL_BOUNDS = {
  min: { x: -0.99808, y: -0.0705, z: -2.704651 },
  max: { x: 0.99808, y: 0.099467, z: 0.99808 }
} as const;

/** Exact physical measurements derived from `HEALTH_DIAL_MODEL_BOUNDS`. */
export const HEALTH_DIAL_MODEL_SIZE_MM = {
  width: 50.702464,
  height: 4.3171618,
  length: 94.0493674
} as const;

/**
 * The texture authors paint. OBJ UVs are resolution-independent, but a fixed
 * 1:2 canvas gives the PSD, browser preview, and exported texture one contract.
 */
export const HEALTH_DIAL_ATLAS = {
  width: 1024,
  height: 2048,
  /** Top-facing portrait disc. V is Wavefront's bottom-up coordinate. */
  front: { uMin: 0.074133, uMax: 0.925867, vMin: 0.53788, vMax: 0.963123 },
  /** Underside portrait disc. */
  back: { uMin: 0.068858, uMax: 0.931142, vMin: 0.034414, vMax: 0.464925 },
  /** Counter body, including the left and right trigger surfaces. */
  controls: { uMin: 0.016583, uMax: 0.963455, vMin: 0.409119, vMax: 0.51747 },
  /** Separate reset tab. */
  reset: { uMin: 0.385706, uMax: 0.617489, vMin: 0.480354, vMax: 0.520584 }
} as const;

/** Object-space anchors shared by Lua and browser-preview label placement. */
export const HEALTH_DIAL_CONTROLS = {
  value: { x: 0, z: -1.6 },
  lower: { x: -0.6, z: -1.7 },
  raise: { x: 0.6, z: -1.7 },
  reset: { x: 0, z: -2.5 },
  /** Broad non-overlapping trigger targets, in model/TTS units. */
  lowerTarget: { x: -0.95, z: -1.7, width: 1, height: 1.2 },
  raiseTarget: { x: 0.95, z: -1.7, width: 1, height: 1.2 },
  resetTarget: { x: 0, z: -2.5, width: 1.1, height: 0.5 }
} as const;

/** Neutral texture colour used wherever an author's art does not reach. */
export const HEALTH_DIAL_RIM = '#1a1a1a';

/** Fixed label colour used by the TTS script and the browser preview. */
export const HEALTH_DIAL_INK = '#ffffff';

/**
 * The reliable counter script shipped in the saved-object template.
 *
 * The exporter rewrites MIN_VALUE, MAX_VALUE, and VALUE by reading this as a
 * flat CONFIG table. Keep every entry a scalar on its own line and its closing
 * brace in the first column. Positions mirror `HEALTH_DIAL_CONTROLS`; Lua must
 * repeat the numbers because TTS executes the saved object without this app.
 */
export const HEALTH_DIAL_LUA = String.raw`--[[
  Health dial — Unmatched Labs.

  The fixed model has a portrait disc, a counter body, and a reset tab. The
  value is the only scripted text. The side arrows and RESET belong to the
  skin; separate transparent buttons make those illustrated panels clickable.

  Two TTS behaviours are deliberately preserved here:

  1. The working source object creates the value first, as button index 0,
     with a 1.5x UI scale and zero-sized plate. Preserve that exact mechanism:
     the later invisible controls must never take index 0 from the value.
  2. Do not call self.clearButtons() inside createAll. Clearing and recreating in the
     same frame can remove the newly-created controls along with the old ones.

  The CONFIG table is rewritten by the exporter. Keep each entry a plain scalar
  on its own line and keep the closing brace in the first column.
]]

CONFIG = {
    MIN_VALUE = 0,
    MAX_VALUE = 20,
    VALUE = 20,
    NUMBER_SIZE = 400,
    INK = "ffffff",
    PLATE = "1a1a1a",
    SHOW_TOOLTIP = true,
}

local CONTROL_SCALE = { x = 1.5, y = 1.5, z = 1.5 }

local VALUE_X = 0
local VALUE_Z = -1.6
local LOWER_Z = -1.7
local RAISE_Z = -1.7
local RESET_Z = -2.5

-- The visible triggers sit on the model; their targets extend into open table
-- space. The 0.45-wide centre gap keeps either target off the health value.
local LOWER_TARGET_X = -0.95
local RAISE_TARGET_X = 0.95
local TRIGGER_TARGET_WIDTH = 450
local TRIGGER_TARGET_HEIGHT = 560
local RESET_TARGET_WIDTH = 520
local RESET_TARGET_HEIGHT = 230

local function clamp(value)
    if value < CONFIG.MIN_VALUE then return CONFIG.MIN_VALUE end
    if value > CONFIG.MAX_VALUE then return CONFIG.MAX_VALUE end
    return value
end

local function colour(hex, alpha)
    local digits = string.gsub(hex, "#", "")
    return {
        r = tonumber(string.sub(digits, 1, 2), 16) / 255,
        g = tonumber(string.sub(digits, 3, 4), 16) / 255,
        b = tonumber(string.sub(digits, 5, 6), 16) / 255,
        a = alpha
    }
end

local function caption()
    if CONFIG.SHOW_TOOLTIP then
        return tostring(CONFIG.VALUE) .. " of " .. tostring(CONFIG.MAX_VALUE)
    end
    return ""
end

local function transparent()
    return { r = 0, g = 0, b = 0, a = 0 }
end

local function hitTarget(handler, x, z, width, height, tooltip, thickness)
    self.createButton({
        click_function = handler,
        function_owner = self,
        label = "",
        tooltip = tooltip,
        position = { x, thickness / 2, z },
        scale = CONTROL_SCALE,
        width = width,
        height = height,
        alignment = 3,
        font_color = transparent(),
        color = transparent()
    })
end

local function createAll()
    local thickness = self.getBoundsNormalized().size.y

    -- The supplied working dial relies on this being button zero. TTS renders
    -- zero-sized label text correctly when it carries the original 1.5x scale.
    self.createButton({
        click_function = "ignore",
        function_owner = self,
        label = tostring(CONFIG.VALUE),
        tooltip = caption(),
        position = { VALUE_X, thickness / 2, VALUE_Z },
        scale = CONTROL_SCALE,
        width = 0,
        height = 0,
        alignment = 3,
        font_size = CONFIG.NUMBER_SIZE,
        font_color = colour(CONFIG.INK, 1),
        color = colour(CONFIG.PLATE, 1)
    })

    hitTarget("lower", LOWER_TARGET_X, LOWER_Z,
        TRIGGER_TARGET_WIDTH, TRIGGER_TARGET_HEIGHT, "Lose one", thickness)
    hitTarget("raise", RAISE_TARGET_X, RAISE_Z,
        TRIGGER_TARGET_WIDTH, TRIGGER_TARGET_HEIGHT, "Gain one", thickness)
    hitTarget("reset", 0, RESET_Z,
        RESET_TARGET_WIDTH, RESET_TARGET_HEIGHT, "Reset to full", thickness)
end

local function step(by, alt)
    if alt then
        CONFIG.VALUE = CONFIG.MAX_VALUE
    else
        CONFIG.VALUE = clamp(CONFIG.VALUE + by)
    end
    self.editButton({
        index = 0,
        label = tostring(CONFIG.VALUE),
        tooltip = caption()
    })
end

function onSave()
    return JSON.encode({ value = CONFIG.VALUE })
end

function onLoad(state)
    if state ~= nil and state ~= "" then
        local ok, saved = pcall(function() return JSON.decode(state) end)
        if ok and saved ~= nil and saved.value ~= nil then
            CONFIG.VALUE = clamp(saved.value)
        end
    end
    Wait.time(createAll, 1, 0)
end

function raise(_object, _colour, alt) step(1, alt) end

function lower(_object, _colour, alt) step(-1, alt) end

function reset() step(0, true) end

function ignore() end

`;
