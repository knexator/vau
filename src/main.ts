import GUI from "lil-gui";
import { Input, KeyCode, Mouse, MouseButton } from "./kommon/input";
import { Color, NaiveSpriteGraphics, ShakuStyleGraphics, initCtxFromSelector, initGlFromSelector } from "./kommon/kanvas";
import { DefaultMap, commonPrefixLen, eqArrays, findIndex, fromCount, fromRange, objectMap, reversed, reversedForEach, zip2 } from "./kommon/kommon";
import { Rectangle, Vec2, mod, towards as approach, lerp, inRange, rand05, remap, clamp, towards, argmax } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";
import Rand, { PRNG } from 'rand-seed';

import grammar from "./sexpr.pegjs?raw"
import * as peggy from "peggy";
import { randomChoice, randomInt, randomChoiceWithoutRepeat, shuffle } from "./kommon/random";

const COLORS = {
  background: Color.fromInt(0x6e6e6e),
  cons: Color.fromInt(0x404040),
};

const ALLOW_KEYBOARD_INPUT = false;

// parser.parse(str)
const parseSexpr: (input: string) => Sexpr = (() => {
  const parser = peggy.generate(grammar);
  return x => parser.parse(x);
})();

type Atom = {
  type: "atom",
  value: string,
}

type Pair = {
  type: "pair",
  left: Sexpr,
  right: Sexpr,
}

type Sexpr = Atom | Pair


// const gl = initGlFromSelector("#gl_canvas");
const ctx = initCtxFromSelector("#ctx_canvas");
// const canvas = gl.canvas as HTMLCanvasElement;
const canvas = ctx.canvas;
// gl.clearColor(...COLORS.background.toArray());
let canvas_size = new Vec2(canvas.width, canvas.height);
const input = new Input(canvas);

let _1 = canvas_size.x / 1280;

// const gfx = new NaiveSpriteGraphics(gl);
// const gfx2 = new ShakuStyleGraphics(gl);

const DEBUG = false;

// The variables we might want to tune while playing
const CONFIG = {
  tmp01: .5,
  tmp1: 1.0,
  tmp10: 10,
  tmp50: 50,
  tmp250: 250,
  tmp500: 500,
  color: "#000000",
};

if (DEBUG) {
  const gui = new GUI();
  gui.add(CONFIG, "tmp01", 0, 1);
  gui.add(CONFIG, "tmp-1", -1, 1);
  gui.add(CONFIG, "tmp10", 0, 20);
  gui.add(CONFIG, "tmp50", 0, 100);
  gui.add(CONFIG, "tmp250", 0, 500);
  gui.add(CONFIG, "tmp500", 0, 1000);
  gui.addColor(CONFIG, "color");
  gui.domElement.style.bottom = "0px";
  gui.domElement.style.top = "auto";
  // gui.hide();
}

function myFillText(ctx: CanvasRenderingContext2D, text: string, pos: Vec2) {
  // let to_draw: {view: MoleculeView, data: Sexpr}[] = [];
  let to_draw: { data: Sexpr, line: number, col: number }[] = [];
  let lines = text.split('\n');
  lines.forEach((line, k) => {
    while (line.includes('&')) {
      let n = line.indexOf('&');
      let n2 = line.indexOf('&', n + 1);
      let sexpr_text = line.slice(n + 1, n2);
      try {
        to_draw.push({ data: parseSexpr(sexpr_text), line: k, col: n });
      } catch {
        console.log("invalid sexpr: ", sexpr_text);
      }
      line = line.slice(0, n) + "    " + line.slice(n2 + 1);
      lines[k] = line;
    }
    ctx.fillText(line, pos.x, pos.y + k * 40 * _1);
  });
  to_draw.forEach(thing => {
    let left = pos.x - ctx.measureText(lines[thing.line]).width / 2;
    // drawMolecule(thing.data, {halfside: 20, pos: new Vec2(left + CONFIG.tmp50 + thing.col * CONFIG.tmp10, pos.y + thing.line * 40)});
    drawMolecule(thing.data, { halfside: 20 * _1, pos: new Vec2(left + 20 * _1 + thing.col * 13.7 * _1, pos.y + thing.line * 40 * _1) });
  })
}

function fillText(ctx: CanvasRenderingContext2D, text: string, pos: Vec2) {
  ctx.fillText(text, pos.x, pos.y);
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rectangle) {
  ctx.fillRect(rect.topLeft.x, rect.topLeft.y, rect.size.x, rect.size.y);
}

function strokeRect(ctx: CanvasRenderingContext2D, rect: Rectangle) {
  ctx.strokeRect(rect.topLeft.x, rect.topLeft.y, rect.size.x, rect.size.y);
}

function moveTo(ctx: CanvasRenderingContext2D, { x, y }: Vec2) {
  ctx.moveTo(x, y);
}
function lineTo(ctx: CanvasRenderingContext2D, { x, y }: Vec2) {
  ctx.lineTo(x, y);
}

// let spike_perc = CONFIG.tmp01;
let spike_perc = 1 / 2;

// actual game logic
let cur_base_molecule = parseSexpr("(+  (1 1 1) . (+ (1 1) . (1)))");
let cur_target = parseSexpr("(1 1 1 1 1 1)");
let cur_molecule_address = [] as Address;
let base_molecule_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.1, .5)),
  halfside: Math.floor(canvas_size.y * .2),
};
let target_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.05, .1)),
  halfside: 35 * _1,
};

let base_vau_view: VauView = {
  pos: base_molecule_view.pos.addX(base_molecule_view.halfside * 5),
  halfside: base_molecule_view.halfside,
};

const N_TESTS = 20;
let failed_cur_test = false;

let testing_animation_state: { test_case_n: number, cur_iters: number, total_iters: number } | null = null;
let animation_state: {
  animating_vau_view: Anim<VauView>,
  transformed_base_molecule: Sexpr,
  molecule_fade: number,
  // new_molecule_opacity: number,
  vau_molecule_opacity: number,
  molecule_address: Address,
  // bindings: Binding[],
  floating_binds: null | { binding: Binding, view: Anim<MoleculeView> }[],
  failed_bind_names: string[],
  binds_done: boolean,
  speed: number,
} | null = null;

function offsetVauView(view: VauView, vertical_offset: number): VauView {
  return { pos: view.pos.addY(canvas_size.y * vertical_offset), halfside: view.halfside };
}

const default_vau: Pair = parseSexpr(`(
  (nil . @2)
  .
  (@2 . nil)
)`) as Pair;

let cur_vaus: Pair[] = [
  parseSexpr(`(
    (+ . ((@h . @t) . @b))
    .
    (+ . (@t . (@h . @b)))
  )`) as Pair,
  parseSexpr(`(
    (+ . (nil . @a))
    .
    @a
  )`) as Pair,
];
let cur_vau_index = 0;
let vau_index_visual_offset = 0;
let vau_toolbar_offset = 0;

let cur_test_case: number = 0;

type Address = boolean[];

function getAtAddress(molecule: Sexpr, address: Address): Sexpr {
  let result = molecule;
  for (let k = 0; k < address.length; k++) {
    if (result.type === "atom") throw new Error(`cant access ${molecule} at ${address}`);
    result = address[k] ? result.left : result.right;
  }
  return result;
}

function cloneSexpr(sexpr: Sexpr): Sexpr {
  if (sexpr.type === "atom") {
    return { type: "atom", value: sexpr.value };
  } else {
    return {
      type: "pair",
      left: cloneSexpr(sexpr.left),
      right: cloneSexpr(sexpr.right)
    };
  }
}

/** returns a copy */
function setAtAddress(molecule: Sexpr, address: Address, value: Sexpr): Sexpr {
  if (address.length === 0) return value;
  const result = cloneSexpr(molecule);
  let parent = result;
  for (let k = 0; k < address.length - 1; k++) {
    if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
    parent = address[k] ? parent.left : parent.right;
  }
  if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
  if (address[address.length - 1]) {
    parent.left = value;
  } else {
    parent.right = value;
  }
  return result;
}

type Binding = {
  name: string,
  address: Address,
  value: Sexpr,
}

// returns null if the template doesn't fit
function generateBindings(molecule: Sexpr, template: Sexpr, address: Address = []): Binding[] | null {
  if (template.type === "atom") {
    if (template.value[0] === "@") {
      return [{ name: template.value, address: address, value: structuredClone(molecule) }];
    } else if (molecule.type === "atom" && molecule.value === template.value) {
      return [];
    } else {
      return null;
    }
  } else {
    if (molecule.type === "atom") {
      return null;
    } else {
      const left_match = generateBindings(molecule.left, template.left, [...address, true]);
      const right_match = generateBindings(molecule.right, template.right, [...address, false]);
      if (left_match === null || right_match === null) {
        return null;
      } else {
        return left_match.concat(right_match);
      }
    }
  }
}

function findBindingTargets(template: Sexpr, binding: Binding, cur_address: Address): Address[] {
  if (template.type === "atom") {
    if (template.value[0] === "@" && binding.name === template.value) {
      return [cur_address];
    } else {
      return [];
    }
  } else {
    return [
      ...findBindingTargets(template.left, binding, [...cur_address, true]),
      ...findBindingTargets(template.right, binding, [...cur_address, false])
    ];
  }
}

function applyBindings(template: Sexpr, bindings: Binding[]): Sexpr {
  if (template.type === "atom") {
    if (template.value[0] === "@") {
      const matching_binding = bindings.find(({ name }) => name === template.value);
      if (matching_binding !== undefined) {
        return matching_binding.value;
      } else {
        return template;
      }
    } else {
      return template;
    }
  } else {
    return {
      type: "pair",
      left: applyBindings(template.left, bindings),
      right: applyBindings(template.right, bindings)
    };
  }
}

function afterVau(molecule: Sexpr, vau: Pair): { new_molecule: Sexpr, bindings: Binding[] } | null {
  const bindings = generateBindings(molecule, vau.left);
  if (bindings === null) return null;
  return { new_molecule: applyBindings(vau.right, bindings), bindings: bindings };
}

function afterRecursiveVau(molecule: Sexpr, vau: Pair): { bound_at: Address, new_molecule: Sexpr, bindings: Binding[] } | null {
  let addresses_to_try: Address[] = [[]];
  while (addresses_to_try.length > 0) {
    const cur_address = addresses_to_try.shift()!;
    const cur_molecule = getAtAddress(molecule, cur_address);
    const result = afterVau(cur_molecule, vau);
    if (result !== null) {
      return {
        bound_at: cur_address,
        new_molecule: setAtAddress(molecule, cur_address, result.new_molecule),
        bindings: result.bindings,
      };
    } else if (cur_molecule.type === "pair") {
      addresses_to_try.push([...cur_address, true]);
      addresses_to_try.push([...cur_address, false]);
    }
  }
  return null;
}


function isValidAddress(molecule: Sexpr, address: Address): boolean {
  try {
    getAtAddress(molecule, address);
    return true;
  } catch (error) {
    return false;
  }
}

const colorFromAtom: (atom: string) => Color = (() => {
  let generated = new Map<string, Color>();
  generated.set("nil", new Color(.5, .5, .5));
  generated.set("true", new Color(.5, .9, .5));
  generated.set("false", new Color(.9, .5, .5));
  generated.set("input", new Color(.1, .6, .6));
  generated.set("output", Color.fromInt(0xb8a412));
  generated.set("v1", new Color(.9, .9, .3));
  generated.set("v2", new Color(.3, .9, .9));
  generated.set("v3", new Color(.9, .3, .9));
  generated.set("f1", Color.fromInt(0x9E008B));
  `#ff0000
  #ffff00
  #c71585
  #00fa9a
  #0000ff
  #1e90ff
  #ffdab9`.trim().split('\n').forEach((s, k) => {
    generated.set(k.toString(), Color.fromHex(s));
  });

  return (atom: string) => {
    let color = generated.get(atom)
    if (color !== undefined) {
      return color;
    } else {
      color = new Color(Math.random(), Math.random(), Math.random(), 1);
      generated.set(atom, color);
      return color;
    }
  }
})();

type MoleculeView = { pos: Vec2, halfside: number };
function drawMoleculeNonRecursive(data: Sexpr, view: MoleculeView) {
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      ctx.beginPath();
      let prev_alpha = ctx.globalAlpha;
      ctx.globalAlpha = .5 * prev_alpha;
      ctx.fillStyle = colorFromAtom(data.value.slice(1)).toHex();
      moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-view.halfside));
      // lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
      // lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, -view.halfside)));
      lineTo(ctx, view.pos.addX(view.halfside * (3 + spike_perc)));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, view.halfside)));
      lineTo(ctx, view.pos.addY(view.halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = prev_alpha;
    } else {
      let profile = atom_shapes.get(data.value);
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value).toHex();
      moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-view.halfside));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
      profile.forEach(({ x: time, y: offset }) => {
        let thing = new Vec2(view.halfside * 2 + offset * view.halfside, lerp(-view.halfside, 0, time));
        lineTo(ctx, view.pos.add(thing));
      });
      reversedForEach(profile, ({ x: time, y: offset }) => {
        let thing = new Vec2(view.halfside * 2 - offset * view.halfside, lerp(view.halfside, 0, time));
        lineTo(ctx, view.pos.add(thing));
      });
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
      lineTo(ctx, view.pos.addY(view.halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    const halfside = view.halfside;
    ctx.beginPath();
    ctx.fillStyle = COLORS.cons.toHex();
    moveTo(ctx, view.pos.addX(-halfside * spike_perc));
    lineTo(ctx, view.pos.addY(-halfside));
    const middle_right_pos = view.pos.addX(halfside / 2);
    lineTo(ctx, middle_right_pos.add(new Vec2(0, -halfside)));
    lineTo(ctx, middle_right_pos.add(new Vec2(-spike_perc * halfside / 2, -halfside / 2)));
    lineTo(ctx, middle_right_pos);
    lineTo(ctx, middle_right_pos.add(new Vec2(-spike_perc * halfside / 2, halfside / 2)));
    lineTo(ctx, middle_right_pos.add(new Vec2(0, halfside)));
    lineTo(ctx, view.pos.addY(halfside));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawBigBind(name: string, view: MoleculeView) {
  if (name[0] !== "@") throw new Error("");
  ctx.beginPath();
  let prev_alpha = ctx.globalAlpha;
  ctx.globalAlpha = .5 * prev_alpha;
  ctx.fillStyle = colorFromAtom(name.slice(1)).toHex();
  moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
  lineTo(ctx, view.pos.addY(-view.halfside));
  lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, -view.halfside)));
  lineTo(ctx, view.pos.addX(view.halfside * (3 + spike_perc)));
  lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, view.halfside)));
  lineTo(ctx, view.pos.addY(view.halfside));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = prev_alpha;
}

function drawMolecule(data: Sexpr, view: MoleculeView) {
  drawMoleculeNonRecursive(data, view);
  if (data.type === "pair") {
    drawMolecule(data.left, getChildView(view, true));
    drawMolecule(data.right, getChildView(view, false));
  }
}

function drawMoleculeExceptFor(data: Sexpr, view: MoleculeView, root_exceptions: Address[], cur_address: Address) {
  if (root_exceptions.some(x => eqArrays(x, cur_address))) return;
  drawMoleculeNonRecursive(data, view);
  if (data.type === "pair") {
    drawMoleculeExceptFor(data.left, getChildView(view, true), root_exceptions, [...cur_address, true]);
    drawMoleculeExceptFor(data.right, getChildView(view, false), root_exceptions, [...cur_address, false]);
  }
}

function drawMoleculeDuringAnimation(data: Sexpr, view: MoleculeView, address: Address) {
  if (animation_state === null) throw new Error("");
  if (eqArrays(address, animation_state.molecule_address)) {
    ctx.globalAlpha = 1 - animation_state.molecule_fade;
    drawMoleculeExceptFor(data, {
      pos: view.pos.subY(animation_state.molecule_fade * base_vau_view.halfside / 2),
      halfside: view.halfside,
    }, (animation_state.floating_binds === null) ? [] : animation_state.floating_binds.map(x => [...animation_state!.molecule_address, ...x.binding.address]), address);
    ctx.globalAlpha = 1;
  } else {
    drawMoleculeNonRecursive(data, view);
    if (data.type === "pair") {
      drawMoleculeDuringAnimation(data.left, getChildView(view, true), [...address, true]);
      drawMoleculeDuringAnimation(data.right, getChildView(view, false), [...address, false]);
    }
  }
}

function drawMoleculeHighlight(data: Sexpr, view: MoleculeView, color: string) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
  lineTo(ctx, view.pos.addY(-view.halfside));
  if (data.type === "atom" && data.value[0] === "@") {
    lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, -view.halfside)));
    lineTo(ctx, view.pos.addX(view.halfside * (3 + spike_perc)));
    lineTo(ctx, view.pos.add(new Vec2(view.halfside * 3, view.halfside)));
  } else {
    lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
    lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
  }
  lineTo(ctx, view.pos.addY(view.halfside));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "black";
}

// Given that the child at the given path has the given view, get the grandparents view
function getGrandparentView(grandchild: MoleculeView, path_to_child: Address): MoleculeView {
  let result = grandchild;
  for (let k = path_to_child.length - 1; k >= 0; k--) {
    result = getParentView(result, path_to_child[k]);
  }
  return result;
}

function getParentView(child: MoleculeView, is_left: boolean): MoleculeView {
  return {
    pos: child.pos.add(new Vec2(-child.halfside, (is_left ? 1 : -1) * child.halfside)),
    halfside: child.halfside * 2,
  };
}

function getChildView(parent: MoleculeView, is_left: boolean): MoleculeView {
  return {
    pos: parent.pos.add(new Vec2(parent.halfside / 2, (is_left ? -1 : 1) * parent.halfside / 2)),
    halfside: parent.halfside / 2,
  };
}

// Given that the grandparent has the given view, find the view at the given address
function getGrandchildView(grandparent: MoleculeView, path_to_child: Address): MoleculeView {
  let result = grandparent;
  for (let k = 0; k < path_to_child.length; k++) {
    result = getChildView(result, path_to_child[k]);
  }
  return result;
}

function getMatcherGrandchildView(grandparent: VauView, path_to_child: Address): VauView {
  let result = grandparent;
  for (let k = 0; k < path_to_child.length; k++) {
    result = getMatcherChildView(result, path_to_child[k]);
  }
  return result;
}

function moleculeAdressFromScreenPosition(screen_pos: Vec2, data: Sexpr, view: MoleculeView): Address | null {
  const delta_pos = screen_pos.sub(view.pos).scale(1 / view.halfside);
  if (!inRange(delta_pos.y, -1, 1)) return null;
  if (data.type === "atom") {
    let max_x = (data.value[0] === "@") ? (3 + (1 - Math.abs(delta_pos.y)) * spike_perc) : 2
    if (inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * spike_perc, max_x)) {
      return []
    } else {
      return null;
    }
  } else {
    // are we selecting a subchild?
    if (data.type === "pair" && delta_pos.x >= .5 - spike_perc / 2) {
      const is_left = delta_pos.y <= 0;
      const maybe_child = moleculeAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getChildView(view, is_left));
      if (maybe_child !== null) {
        return [is_left, ...maybe_child];
      }
    }
    // no subchild, stricter selection than atom:
    if (inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * spike_perc, .5)) {
      // path to this
      return [];
    } else {
      return null;
    }
  }
}

function matcherAdressFromScreenPosition(screen_pos: Vec2, data: Sexpr, view: VauView): Address | null {
  const delta_pos = screen_pos.sub(view.pos).scale(1 / view.halfside);
  if (!inRange(delta_pos.y, -1, 1)) return null;
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      return inRange(delta_pos.x, -3 + (Math.abs(delta_pos.y) - 1) * spike_perc, -(Math.abs(delta_pos.y) - 1) * spike_perc) ? [] : null;
    } else {
      return inRange(delta_pos.x, -1, -(Math.abs(delta_pos.y) - 1) * spike_perc) ? [] : null;
    }
  } else {
    // are we selecting a subchild?
    if (data.type === "pair" && -delta_pos.x >= .5 - spike_perc / 2) {
      const is_left = delta_pos.y <= 0;
      const maybe_child = matcherAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getMatcherChildView(view, is_left));
      if (maybe_child !== null) {
        return [is_left, ...maybe_child];
      }
    }
    // no subchild, stricter selection than atom:
    if (inRange(-delta_pos.x, (Math.abs(delta_pos.y) - 1) * spike_perc, 1)) {
      // path to this
      return [];
    } else {
      return null;
    }
  }
}

function drawMatcherDuringAnimation(data: Sexpr, view: VauView) {
  if (animation_state === null) throw new Error("");
  if (animation_state.floating_binds !== null && data.type === "atom"
    && data.value[0] === "@" && !animation_state.failed_bind_names.includes(data.value)) return;
  drawMatcherNonRecursive(data, view);
  if (data.type === "pair") {
    drawMatcherDuringAnimation(data.left, getMatcherChildView(view, true));
    drawMatcherDuringAnimation(data.right, getMatcherChildView(view, false));
  }
}


type VauView = { pos: Vec2, halfside: number };
function drawVauDuringAnimtion(data: Pair, view: VauView) {
  if (animation_state === null) throw new Error("");
  ctx.globalAlpha = 1 - animation_state.molecule_fade;
  drawMatcherDuringAnimation(data.left, view);
  if (animation_state.binds_done) {
    ctx.globalAlpha = 1;
    drawMolecule(getAtAddress(animation_state.transformed_base_molecule, animation_state.molecule_address), getVauMoleculeView(view));
  }
  ctx.globalAlpha = animation_state.vau_molecule_opacity;
  drawMolecule(data.right, getVauMoleculeView(view));
  ctx.globalAlpha = 1;
}

function drawVau(data: Pair, view: VauView) {
  drawMatcher(data.left, view);
  drawMolecule(data.right, getVauMoleculeView(view));
}

function getVauMoleculeView(view: VauView): MoleculeView {
  return {
    halfside: view.halfside,
    pos: view.pos.add(new Vec2(spike_perc * view.halfside / 2, view.halfside / 2)),
  };
}

function drawMatcherHighlight(data: Sexpr, view: VauView, color: string) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  moveTo(ctx, view.pos.addX(view.halfside * spike_perc));
  lineTo(ctx, view.pos.addY(-view.halfside));
  if (data.type === "atom" && data.value[0] === "@") {
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, -view.halfside)));
    lineTo(ctx, view.pos.addX(-view.halfside * (3 + spike_perc)));
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, view.halfside)));
  } else if (data.type === "pair") {
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, -view.halfside)));
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, view.halfside)));
  } else {
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 1, -view.halfside)));
    lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 1, view.halfside)));
  }
  lineTo(ctx, view.pos.addY(view.halfside));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "black";
}


function drawMatcherNonRecursive(data: Sexpr, view: VauView) {
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      const halfside = view.halfside;
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value.slice(1)).toHex();
      let prev_alpha = ctx.globalAlpha;
      ctx.globalAlpha = .5 * prev_alpha;
      moveTo(ctx, view.pos.addX(halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-halfside));
      lineTo(ctx, view.pos.add(new Vec2(-halfside * 3, -halfside)));
      lineTo(ctx, view.pos.addX(-halfside * 3 - halfside * spike_perc));
      lineTo(ctx, view.pos.add(new Vec2(-halfside * 3, halfside)));
      lineTo(ctx, view.pos.addY(halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = prev_alpha;
    } else {
      const halfside = view.halfside;
      let profile = atom_shapes.get(data.value);
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value).toHex();
      moveTo(ctx, view.pos.addX(halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-halfside));
      lineTo(ctx, view.pos.add(new Vec2(-halfside, -halfside)));
      profile.forEach(({ x: time, y: offset }) => {
        let thing = new Vec2(-halfside + offset * view.halfside, lerp(-view.halfside, 0, time));
        lineTo(ctx, view.pos.add(thing));
      });
      reversedForEach(profile, ({ x: time, y: offset }) => {
        let thing = new Vec2(-halfside - offset * view.halfside, lerp(view.halfside, 0, time));
        lineTo(ctx, view.pos.add(thing));
      });
      lineTo(ctx, view.pos.add(new Vec2(-halfside, halfside)));
      lineTo(ctx, view.pos.addY(halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    const halfside = view.halfside;
    ctx.beginPath();
    ctx.fillStyle = COLORS.cons.toHex();
    moveTo(ctx, view.pos.addX(halfside * spike_perc));
    lineTo(ctx, view.pos.addY(-halfside));
    const middle_right_pos = view.pos.addX(-halfside);
    lineTo(ctx, middle_right_pos.add(new Vec2(0, -halfside)));
    lineTo(ctx, middle_right_pos.add(new Vec2(spike_perc * halfside / 2, -halfside / 2)));
    lineTo(ctx, middle_right_pos);
    lineTo(ctx, middle_right_pos.add(new Vec2(spike_perc * halfside / 2, halfside / 2)));
    lineTo(ctx, middle_right_pos.add(new Vec2(0, halfside)));
    lineTo(ctx, view.pos.addY(halfside));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawMatcher(data: Sexpr, view: VauView) {
  drawMatcherNonRecursive(data, view);
  if (data.type === "pair") {
    drawMatcher(data.left, getMatcherChildView(view, true));
    drawMatcher(data.right, getMatcherChildView(view, false));
  }
}

function getMatcherChildView(parent: VauView, is_left: boolean): VauView {
  return {
    pos: parent.pos.add(new Vec2(-parent.halfside, (is_left ? -1 : 1) * parent.halfside / 2)),
    halfside: parent.halfside / 2,
  };
}

type Anim<T> = { progress: number, duration: number, callback: (t: number) => T }

function advanceAnim<T>(anim: Anim<T>, dt: number): T {
  anim.progress = approach(anim.progress, 1, dt / anim.duration);
  return anim.callback(anim.progress);
}

function makeConstantAnim<T>(value: T): Anim<T> {
  return {
    progress: 1,
    duration: 1,
    callback(_t) {
      return value;
    },
  }
}

function makeLerpAnim<T>(a: T, b: T, duration: number, lerp: (a: T, b: T, t: number) => T): Anim<T> {
  return {
    progress: 0,
    duration: duration,
    callback(t) {
      return lerp(a, b, t);
    },
  }
}

function queueAnims<T>(anims: Anim<T>[]): Anim<T> {
  const total_duration = anims.reduce((acc, v) => acc + v.duration, 0);
  return {
    progress: 0,
    duration: total_duration,
    callback(t) {
      let time = t * total_duration;
      let index = 0;
      while (time > anims[index].duration) {
        time -= anims[index].duration;
        index += 1;
        if (index === anims.length) {
          // float precision, agh
          index -= 1;
          break;
        }
      }
      return anims[index].callback(time / anims[index].duration);
    },
  }
}

function getFinalValue<T>(anim: Anim<T>): T {
  return anim.callback(1);
}

function lerpMoleculeViews(a: MoleculeView, b: MoleculeView, t: number): MoleculeView {
  return {
    pos: Vec2.lerp(a.pos, b.pos, t),
    halfside: lerp(a.halfside, b.halfside, t),
  };
}

const cur_molecule_view = {
  duration: .1,
  setTarget: function (v: MoleculeView): void {
    this.anim = makeLerpAnim(getFinalValue(this.anim), v, this.duration, lerpMoleculeViews);
  },
  anim: makeConstantAnim(base_molecule_view),
  updateTarget: function (): void {
    let new_target = getGrandparentView(base_molecule_view, cur_molecule_address);
    this.setTarget(new_target);
  },
  instantlyUpdateTarget: function (): void {
    this.updateTarget();
    this.anim.progress = 1;
  },
  get cur(): MoleculeView {
    return this.anim.callback(this.anim.progress);
  },
  animateToAdress: function (new_address: Address): void {
    // Proper animation: don't jump between cousins
    // let common_prefix_len = commonPrefixLen(cur_molecule_address, new_address);
    // console.log(common_prefix_len);
    // let last_view = this.cur;
    // let anims = [];
    // for (let k = cur_molecule_address.length - 1; k >= common_prefix_len; k--) {
    //   let cur_view = getGrandparentView(base_molecule_view, cur_molecule_address.slice(0, k));
    //   anims.push(
    //     makeLerpAnim(last_view, cur_view, .2, lerpMoleculeViews)
    //   );
    //   last_view = cur_view;
    // }
    // for (let k = common_prefix_len + 1; k <= new_address.length; k++) {
    //   let cur_view = getGrandparentView(base_molecule_view, new_address.slice(0, k));
    //   anims.push(
    //     makeLerpAnim(last_view, cur_view, .2, lerpMoleculeViews)
    //   );
    //   last_view = cur_view;
    // }
    // cur_molecule_address = new_address;
    // this.anim = queueAnims(anims);

    // Simplest animation
    cur_molecule_address = new_address;
    this.updateTarget();

    // TODO: better animation
  },
}

type MoleculePlace = { type: "none" } | {
  type: "molecule",
  molecule_address: Address
} | {
  type: "vau_molecule",
  vau_molecule_address: Address
} | {
  type: "vau_matcher",
  vau_matcher_address: Address
} | {
  type: "toolbar_atoms",
  atom_index: number,
} | {
  type: "toolbar_templates",
  template_index: number,
}

let mouse_state: {
  type: "none"
} | {
  type: "holding",
  value: Sexpr,
  source: MoleculePlace,
} = { type: "none" };

const misc_atoms = "v1,v2,v3".split(",").map(doAtom);
let toolbar_atoms: { view: MoleculeView, value: Sexpr }[] = [doPair(doAtom("nil"), doAtom("nil")), ...(
  ["nil", "true", "false", "input", "output", "v1", "v2", "v3", "f1", "f2"].map(doAtom))].map((value, k) => {
    return { value, view: { pos: new Vec2((340 + 60 * k) * _1, 40 * _1), halfside: 20 * _1 } };
  });

fromCount(11, k => {
  return { view: { pos: new Vec2(340 + 60 * k, 40).scale(_1), halfside: 20 * _1 }, value: k === 0 ? doPair(doAtom("0"), doAtom("0")) : doAtom((k - 1).toString()) }
});

let toolbar_templates: { view: VauView, value: Sexpr, used: boolean }[] = fromCount(7, k => {
  return { view: { pos: new Vec2(400 + 95 * k, 100).scale(_1), halfside: 20 * _1 }, value: doAtom(`@${k}`), used: false };
});

// let toolbar_vaus: {}

function doList(values: Sexpr[]): Sexpr {
  let result = doAtom("nil") as Sexpr;
  reversedForEach(values, v => {
    result = doPair(v, result);
  });
  return result;
}

function doPair(left: Sexpr, right: Sexpr): Pair {
  return { type: "pair", left, right };
}

function doAtom(value: string): Atom {
  return { type: "atom", value };
}

function containsTemplate(v: Sexpr): boolean {
  if (v.type === "atom") return v.value[0] === "@";
  return containsTemplate(v.left) || containsTemplate(v.right);
}

function eqSexprs(a: Sexpr, b: Sexpr): boolean {
  if (a.type === "atom" && b.type === "atom") return a.value === b.value
  if (a.type === "pair" && b.type === "pair") {
    return eqSexprs(a.left, b.left) && eqSexprs(a.right, b.right);
  }
  return false;
}

class Level {
  constructor(
    public id: string,
    public description: string,
    public generate_test: (rand: Rand) => [Sexpr, Sexpr],
    public user_slots: SolutionSlot[] = [],
  ) { }

  get_test(n: number) {
    return this.generate_test(new Rand(`test_${n}`));
  }
}
type SolutionSlot = {
  name: string,
  vaus: Pair[],
  stats: null | {
    n_vaus: number,
    n_colors: number,
    n_steps: number,
  },
};

// let STATE: {
//   type: "menu",
//   selected_level_index: number | null,
//   selected_solution_slot: number | null,
// } | { type: "game" } = { type: "menu", selected_level_index: null, selected_solution_slot: null };
let STATE: "menu" | "game" = "menu";
let selected_level_index: number | null = null;
let selected_menu_test: number = 0

let cur_solution_slot: number = 0;
let cur_level: Level;

let levels: Level[] = [
  new Level(
    "simplest",
    "Substitution:\nWe have too many &v1&, &v2&,\nand &v3& samples. Vau all of\nthem into &f1&.",
    (rand) => {
      return [
        randomChoice(rand, misc_atoms),
        doAtom("f1"),
      ];
      // let originals = misc_atoms;
      // let targets = [...misc_atoms.slice(1), misc_atoms[0]];
      // let k = randomInt(rand, 0, misc_atoms.length);
      // return [
      //   doPair(
      //     doAtom("input"),
      //     originals[k],
      //   ),
      //   doPair(
      //     doAtom("output"),
      //     targets[k],
      //   ),
      // ];
    }
  ),
  new Level(
    "anyred",
    "Spike Detector:\nSome of our pure &true& samples have\nbeen contaminated with &false&,\nmake a detector that outputs &false&\nfor contaminated samples\nand &true& otherwise",
    (rand) => {
      let final_has_red = rand.next() > .3;
      function helper(has_red: boolean, depth: number): Sexpr {
        if (depth === 0) {
          if (has_red) {
            return doAtom("false");
          } else {
            return doAtom("true");
          }
        } else {
          let left_has_red = has_red;
          let right_has_red = has_red;
          if (has_red && rand.next() > .3) {
            if (rand.next() < .5) {
              left_has_red = false;
            } else {
              right_has_red = false;
            }
          }
          return doPair(
            helper(left_has_red, depth - 1),
            helper(right_has_red, depth - 1),
          );
        }
      }
      return [
        helper(final_has_red, Math.floor(rand.next() * 3) + 2),
        doAtom(final_has_red ? "false" : "true"),
      ];
    }
  ),
  new Level(
    "switch",
    "Switcheroo:\nSeems like we assembled\nsome samples the wrong way around,\n&(v1 . v2)& instead of &(v2 . v1)&. They are\nmarked with &input&; once corrected,\nmark them with &output&. In other words,\ngiven &(input . (v1 . v2))&, return &(output . (v2 . v1))&.",
    (rand) => {
      let v1 = makeRandomSexpr(rand, 4, misc_atoms);
      let v2 = makeRandomSexpr(rand, 4, misc_atoms);
      return [
        doPair(
          doAtom("input"),
          doPair(v1, v2)
        ),
        doPair(
          doAtom("output"),
          doPair(v2, v1)
        ),
      ];
    },
  ),
  new Level(
    "bubbleUp",
    "Bubble Up:\nOur vaus are limited to\nworking on a single sample\nat a time. Luckily, there is\na trick for expressing a list\nof samples in a single sample:\nnest them, ending in &nil&, which\nis also the empty list. For example,\nthe list (&v1&, &v2&) would be &(v1 v2)&\nFor this level, move the &f1&\nto the start of the given list.",
    (rand) => {
      rand.next();
      rand.next();
      rand.next();
      const vanilla_list = fromCount(randomInt(rand, 0, 6), k => randomChoice(rand, misc_atoms));
      const inserted_list = vanilla_list.slice(0)
      inserted_list.splice(randomInt(rand, 0, vanilla_list.length + 1), 0, doAtom("f1"));
      return [
        doList(inserted_list),
        doList([doAtom("f1"), ...vanilla_list]),
      ];
    },
  ),
  new Level(
    "add",
    "Peano Addition:\nAnother fancy trick: to represent\nnumbers, we use a list of &true&.\nFor example, number 3 would be &(true true true)&,\nand 0 would be &()&. For this level,\nadd the 2 given numbers.",
    (rand) => {
      let n1 = Math.floor(rand.next() * 6);
      let n2 = Math.floor(rand.next() * 6);
      return [
        doPair(makePeanoSexpr(n1), makePeanoSexpr(n2)),
        makePeanoSexpr(n1 + n2),
      ];
    },
  ),
  new Level(
    "reverse",
    "List Reverse:\nGiven a list of &v1&, &v2&, &v3&,\nmarked with &input& at the start,\nreverse it.",
    (rand) => {
      rand.next();
      function randomSexpr(max_depth: number): Sexpr {
        if (max_depth === 0) return randomChoice(rand, misc_atoms);
        return doPair(
          randomSexpr(Math.floor(rand.next() * max_depth)),
          randomSexpr(Math.floor(rand.next() * max_depth)),
        );
      }
      // let asdf = fromCount(randomInt(rand, 0, 4), _ => randomSexpr(randomInt(rand, 1, 3)));
      let asdf = fromCount(randomInt(rand, 0, 4), _ => randomSexpr(0));
      return [
        doPair(
          doAtom("input"),
          doList(asdf),
        ),
        doList(reversed(asdf)),
      ]
    }
  ),
  new Level(
    "equal",
    "Equality Check:\nGiven a pair of samples\n(marked by &input&),\nreturn &true& if they are equal\nand &false& otherwise.",
    (rand) => {
      let generate_equal = rand.next() > .5;
      function helper(equal: boolean, max_depth: number): [Sexpr, Sexpr] {
        if (max_depth === 0) {
          let v1 = randomChoice(rand, misc_atoms);
          let v2 = randomChoice(rand, misc_atoms);
          while (v2 === v1) {
            v2 = randomChoice(rand, misc_atoms);
          }
          return [v1, equal ? v1 : v2];
        } else {
          let lefts = helper(equal, Math.floor(rand.next() * max_depth));
          let rights = helper(equal, Math.floor(rand.next() * max_depth));
          return [
            doPair(lefts[0], rights[0]),
            doPair(lefts[1], rights[1]),
          ];
        }
      }
      return [
        doPair(
          doAtom("input"),
          doPair(...helper(generate_equal, Math.floor(rand.next() * 5))),
        ),
        doAtom(generate_equal ? "true" : "false"),
      ]
    }
  ),
  new Level(
    "cadadar_easy",
    "Address Lookup:\nWe have &(input . (f1 . v1))&, where &v1& is a sample\nand &f1& is an address in that sample.\nThe address is a list of &true& and &false&,\nwhere &true& means the top subsample\nand &false& the bottom one. For example,\n&(true true)& would mean 'the top half of the\ntop half of the sample'; for\n&((v1 . v2) . v3)&, it would be &v1&.",
    (rand) => {
      function randomSexpr(max_depth: number, must_have: Address): Sexpr {
        if (max_depth < must_have.length) throw new Error("");
        if (max_depth === 0) return randomChoice(rand, misc_atoms);
        if (must_have.length === 0) {
          return doPair(
            randomSexpr(Math.floor(rand.next() * max_depth), []),
            randomSexpr(Math.floor(rand.next() * max_depth), []),
          );
        }
        let next_is_left = must_have[0];
        let rest = must_have.slice(1);
        if (next_is_left) {
          return doPair(
            randomSexpr(Math.max(rest.length, Math.floor(rand.next() * max_depth)), rest),
            randomSexpr(Math.floor(rand.next() * max_depth), []),
          );
        } else {
          return doPair(
            randomSexpr(Math.floor(rand.next() * max_depth), []),
            randomSexpr(Math.max(rest.length, Math.floor(rand.next() * max_depth)), rest),
          );
        }
      }
      let address = fromCount(randomInt(rand, 0, 4), _ => rand.next() < .5);
      let asdf = randomSexpr(Math.max(address.length, randomInt(rand, 0, 5)), address);
      let result = getAtAddress(asdf, address);
      return [
        doPair(
          doAtom("input"),
          doPair(
            doList(address.map(v => doAtom(v ? "true" : "false"))),
            asdf
          )
        ),
        result
      ];
    }
  ),
  new Level(
    "lookup",
    "Lookup Table:\nWe have &(input . (f1 . v1))&, where &v1& is a key\nand &f1& is a list of (key,value)\npairs (for example, &(v1 . f2)& would be\nkey &v1& and value &f2&).\nReturn the value for the given key.",
    (rand) => {
      function randomSexpr(max_depth: number): Sexpr {
        if (max_depth === 0) return randomChoice(rand, misc_atoms);
        return doPair(
          randomSexpr(Math.floor(rand.next() * max_depth)),
          randomSexpr(Math.floor(rand.next() * max_depth)),
        );
      }
      let keys = randomChoiceWithoutRepeat(rand, misc_atoms, randomInt(rand, 1, misc_atoms.length));
      let dict_values = keys.map(v => doPair(v, randomSexpr(4)));
      let selected = randomChoice(rand, dict_values);
      return [doPair(
        doAtom("input"),
        doPair(
          doList(dict_values),
          selected.left
        )
      ), selected.right]
    }
  ),
  new Level(
    "multiply",
    "Peano Multiplication:\nGiven a pair of numbers marked\nwith &input&, multiply them.",
    (rand) => {
      let n1 = Math.floor(rand.next() * 6);
      let n2 = Math.floor(rand.next() * 6);
      return [
        doPair(doAtom("input"), doPair(makePeanoSexpr(n1), makePeanoSexpr(n2))),
        makePeanoSexpr(n1 * n2),
      ];
    },
  ),
  new Level(
    "majority",
    "Majority Sample:\nGiven a list of &v1&, &v2&, and &v3&,\nreturn the most common one.",
    (rand) => {
      let counts = randomChoiceWithoutRepeat(rand, fromCount(7, k => k), misc_atoms.length);
      let list = shuffle(rand, Array(...zip2(counts, misc_atoms)).flatMap(([count, atom]) => fromCount(count, _ => atom)));
      let majority_atom = misc_atoms[argmax(counts)!];
      return [
        doPair(doAtom("input"), doList(list)),
        majority_atom
      ];
    },
  ),
  new Level(
    "cadadar_hard",
    "Address Lookup 2:\nAs in Address Lookup, &true& means top\nhalf and &false& means bottom half.\nHowever, now they are applied from\nsmaller to bigger; given a list\nof &true& and &false& ending in a sample,\naddress that sample.\n(this one is hard to explain)",
    (rand) => {
      function randomSexpr(max_depth: number, must_have: Address): Sexpr {
        if (max_depth < must_have.length) throw new Error("");
        if (max_depth === 0) return randomChoice(rand, misc_atoms);
        if (must_have.length === 0) {
          return doPair(
            randomSexpr(Math.floor(rand.next() * max_depth), []),
            randomSexpr(Math.floor(rand.next() * max_depth), []),
          );
        }
        let next_is_left = must_have[0];
        let rest = must_have.slice(1);
        if (next_is_left) {
          return doPair(
            randomSexpr(Math.max(rest.length, Math.floor(rand.next() * max_depth)), rest),
            randomSexpr(Math.floor(rand.next() * max_depth), []),
          );
        } else {
          return doPair(
            randomSexpr(Math.floor(rand.next() * max_depth), []),
            randomSexpr(Math.max(rest.length, Math.floor(rand.next() * max_depth)), rest),
          );
        }
      }
      let address = fromCount(randomInt(rand, 0, 4), _ => rand.next() < .5);
      let asdf = randomSexpr(Math.max(address.length, randomInt(rand, 0, 5)), address);
      let result = getAtAddress(asdf, address);
      let problem = asdf;
      address.forEach(v => {
        problem = doPair(doAtom(v ? "true" : "false"), problem);
      });
      return [
        doPair(
          doAtom("input"),
          problem
        ),
        result
      ];
    }
  ),
];

function isValidVau(vau: Pair): boolean {
  function getAllTemplateNames(v: Sexpr): string[] {
    if (v.type === "atom") {
      if (v.value[0] === "@") {
        return [v.value];
      } else {
        return [];
      }
    } else {
      return [...getAllTemplateNames(v.left), ...getAllTemplateNames(v.right)];
    }
  }
  let source_templates = getAllTemplateNames(vau.left);
  // no repeated templates
  if (new Set(source_templates).size < source_templates.length) return false;
  // no orphan templates
  if (getAllTemplateNames(vau.right).some(x => !source_templates.includes(x))) return false;
  return true;
}

function canInteract() {
  return (testing_animation_state === null) && (vau_index_visual_offset === 0) && (animation_state === null);
}

{
  // load
  levels.forEach(level => {
    let stuff = window.localStorage.getItem(`knexator_vau_${level.id}`);
    if (stuff !== null) {
      level.user_slots = JSON.parse(stuff);
      level.user_slots.forEach(x => {
        if (x.stats === undefined) x.stats = null;
      })
      // recalcScores(level);
    }
  });
}

function save_cur_level() {
  failed_cur_test = false;
  window.localStorage.setItem(`knexator_vau_${cur_level.id}`, JSON.stringify(cur_level.user_slots));
}

function recalcScores(level: Level) {
  level.user_slots.forEach(slot => {
    let valid_solution = true;
    let total_steps = 0;
    // const N_TESTS = 20;
    for (let test_n = 0; test_n < N_TESTS; test_n++) {
      let [molecule, target] = level.get_test(test_n);
      let any_changes = true;
      let n_steps = 0;
      const MAX_STEPS = 1000;
      while (n_steps < MAX_STEPS && any_changes) {
        any_changes = false;
        // try all vaus
        for (let k = 0; k < slot.vaus.length; k++) {
          const bind_result = afterRecursiveVau(molecule, slot.vaus[k]);
          if (bind_result !== null) {
            cur_base_molecule = bind_result.new_molecule;
            any_changes = true;
            n_steps += 1;
            break;
          }
        }
      }
      if (n_steps === MAX_STEPS || !eqSexprs(target, molecule)) {
        valid_solution = false;
      }
      total_steps += n_steps;
    }
    if (valid_solution) {
      slot.stats = {
        n_vaus: slot.vaus.length,
        n_steps: total_steps / N_TESTS,
        n_colors: new Set(slot.vaus.flatMap(allAtoms)).size,
      }
    } else {
      slot.stats = null;
    }
  });
}

function allAtoms(vau: Sexpr): string[] {
  if (vau.type === "atom") {
    return [vau.value];
  } else {
    return [...allAtoms(vau.left), ...allAtoms(vau.right)];
  }
}

function makePeanoSexpr(n: number): Sexpr {
  let result: Sexpr = doAtom("nil");
  for (let k = 0; k < n; k++) {
    result = doPair(doAtom("true"), result);
  }
  return result;
}

function makeRandomSexpr(rand: Rand, max_depth: number, pieces: Atom[]): Sexpr {
  if (max_depth == 0 || rand.next() < .2) {
    return randomChoice(rand, pieces);
  } else {
    return doPair(
      makeRandomSexpr(rand, randomInt(rand, 0, max_depth), pieces),
      makeRandomSexpr(rand, randomInt(rand, 0, max_depth), pieces)
    );
  }
}

function coloredButton(text: string, rect: Rectangle, normal: string, hover: string): boolean {
  let mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
  let pressed = false;
  if (canInteract() && rect.contains(mouse_pos)) {
    ctx.fillStyle = hover;
    pressed = input.mouse.wasPressed(MouseButton.Left);
  } else {
    ctx.fillStyle = normal;
  }
  fillRect(ctx, rect);
  ctx.fillStyle = "black";
  fillText(ctx, text, rect.getCenter());
  return pressed;
}

function button(text: string, rect: Rectangle, tooltip: string | null = null): boolean {
  let mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
  let pressed = false;
  if (canInteract() && rect.contains(mouse_pos)) {
    ctx.fillStyle = "#BBBBBB";
    pressed = input.mouse.wasPressed(MouseButton.Left);
    if (tooltip !== null) {
      fillText(ctx, tooltip, rect.bottomRight)
    }
  } else {
    ctx.fillStyle = "#444444";
  }
  fillRect(ctx, rect);
  ctx.fillStyle = "black";
  fillText(ctx, text, rect.getCenter());
  return pressed;
}

function continousAlwaysInteractableButton(text: string, rect: Rectangle): boolean {
  let mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
  let pressed = false;
  if (rect.contains(mouse_pos)) {
    if (input.mouse.isDown(MouseButton.Left)) {
      pressed = true;
      ctx.fillStyle = "#BBBBBB";
    } else {
      ctx.fillStyle = "#999999";
    }
  } else {
    ctx.fillStyle = "#444444";
  }
  fillRect(ctx, rect);
  ctx.fillStyle = "black";
  fillText(ctx, text, rect.getCenter());
  return pressed;
}

function alwaysInteractableButton(text: string, rect: Rectangle): boolean {
  let mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
  let pressed = false;
  if (rect.contains(mouse_pos)) {
    ctx.fillStyle = "#BBBBBB";
    pressed = input.mouse.wasPressed(MouseButton.Left);
  } else {
    ctx.fillStyle = "#444444";
  }
  fillRect(ctx, rect);
  ctx.fillStyle = "black";
  fillText(ctx, text, rect.getCenter());
  return pressed;
}

let last_timestamp = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp: number) {
  // in seconds
  const delta_time = (cur_timestamp - last_timestamp) / 1000;
  last_timestamp = cur_timestamp;
  input.startFrame();
  // spike_perc = CONFIG.tmp01;

  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    canvas_size = new Vec2(canvas.width, canvas.height);
    _1 = canvas_size.x / 1280;
    ctx.font = `${Math.round(_1 * 26)}px monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    base_molecule_view = {
      pos: canvas_size.mul(new Vec2(.1, .5)),
      halfside: Math.floor(canvas_size.y * .2),
    };
    target_view = {
      pos: canvas_size.mul(new Vec2(.05, .1)),
      halfside: 35 * _1,
    };
    base_vau_view = {
      pos: base_molecule_view.pos.addX(base_molecule_view.halfside * 5),
      halfside: base_molecule_view.halfside,
    };
    toolbar_atoms = [doPair(doAtom("nil"), doAtom("nil")), ...(
      ["nil", "true", "false", "input", "output", "v1", "v2", "v3", "f1", "f2"].map(doAtom))].map((value, k) => {
        return { value, view: { pos: new Vec2((340 + 60 * k) * _1, 40 * _1), halfside: 20 * _1 } };
      });
    toolbar_templates = fromCount(7, k => {
      return { view: { pos: new Vec2(400 + 95 * k, 100).scale(_1), halfside: 20 * _1 }, value: doAtom(`@${k}`), used: false };
    });
  }

  // gl.clear(gl.COLOR_BUFFER_BIT);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLORS.background.toHex();
  ctx.fillRect(0, 0, canvas.width, canvas.height);


  switch (STATE) {
    case "menu":
      menu_frame(delta_time);
      break;
    case "game":
      game_frame(delta_time);
      break;
    default:
      throw new Error("");
  }

  requestAnimationFrame(every_frame);
}

function menu_frame(delta_time: number) {
  let mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);

  ctx.beginPath();
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;
  ctx.moveTo(canvas_size.x / 3, 0);
  ctx.lineTo(canvas_size.x / 3, canvas_size.y);
  ctx.moveTo(canvas_size.x * .75, 0);
  ctx.lineTo(canvas_size.x * .75, canvas_size.y);
  ctx.stroke();

  for (let k = 0; k < levels.length; k++) {
    const rect = new Rectangle(new Vec2(50 + mod(k, 4) * 100, 50 + Math.floor(k / 4) * 100).scale(_1), Vec2.both(50 * _1));
    const solved = levels[k].user_slots.some(x => x.stats !== null);
    if (coloredButton(k.toString(), rect,
      !solved ? "#444444" : "#336633",
      !solved ? "#BBBBBB" : "#99DD99",
    )) {
      selected_level_index = k;
    }
    if (selected_level_index === k) {
      strokeRect(ctx, rect);
    }
  }

  if (selected_level_index !== null) {
    let level = levels[selected_level_index]

    myFillText(ctx, level.description, canvas_size.mul(new Vec2(lerp(1 / 3, 3 / 4, .5), .4)));

    // menu sample select
    if (button('<', new Rectangle(canvas_size.mul(new Vec2(.02 + 1 / 3, .0)), new Vec2(canvas_size.x * .05, 25 * _1)))) {
      selected_menu_test -= 1;
    }

    if (button('>', Rectangle.fromParams({ topRight: canvas_size.mul(new Vec2(.75 - .02, .0)), size: new Vec2(canvas_size.x * .05, 25 * _1) }))) {
      selected_menu_test += 1;
    }
    let rand = new Rand(`menu_sample_${level.id}_${selected_menu_test}`);
    const origin_molecule_view: MoleculeView = { pos: canvas_size.mul(new Vec2(.4, .2)), halfside: canvas.height / 8 };
    const target_molecule_view: MoleculeView = { pos: canvas_size.mul(new Vec2(.6, .2)), halfside: canvas.height / 8 }
    const [origin, target] = level.generate_test(rand);
    drawMolecule(origin, origin_molecule_view);
    drawMolecule(target, target_molecule_view);

    level.user_slots.forEach((slot, k) => {
      const solved = slot.stats !== null;
      if (coloredButton(solved ? `time: ${slot.stats!.n_steps} vaus: ${slot.stats!.n_vaus}` : slot.name,
        new Rectangle(new Vec2(canvas_size.x * .75, k * 75 * _1), new Vec2(canvas_size.x * .25, 50 * _1)),
        !solved ? "#444444" : "#336633",
        !solved ? "#BBBBBB" : "#99DD99",
      )) {

        STATE = "game";
        cur_solution_slot = k;
        cur_level = level;
        cur_vaus = slot.vaus;
        vau_index_visual_offset = 0;
        vau_toolbar_offset = 0;
        cur_vau_index = 0;
        cur_test_case = 0;
        cur_molecule_address = [];
        cur_molecule_view.instantlyUpdateTarget();
        [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
        return;
      }
    });

    {
      if (button("New solution", new Rectangle(new Vec2(canvas_size.x * .75, level.user_slots.length * 75 * _1), new Vec2(canvas_size.x * .25, 50 * _1)))) {
        level.user_slots.push({ name: `Solution ${level.user_slots.length}`, vaus: [], stats: null });
      }
    }
  }
}

ctx.font = `${Math.round(_1 * 26)}px monospace`;
ctx.textBaseline = "middle";
ctx.textAlign = "center";

function game_frame(delta_time: number) {
  if (ALLOW_KEYBOARD_INPUT && canInteract()) {
    if (input.keyboard.wasPressed(KeyCode.KeyA)) {
      if (cur_molecule_address.length > 0) {
        cur_molecule_address.pop();
        cur_molecule_view.updateTarget();
      }
    }
    if (input.keyboard.wasPressed(KeyCode.KeyW)) {
      if (isValidAddress(cur_base_molecule, [...cur_molecule_address, true])) {
        cur_molecule_address.push(true);
        cur_molecule_view.updateTarget();
      }
    }
    if (input.keyboard.wasPressed(KeyCode.KeyS)) {
      if (isValidAddress(cur_base_molecule, [...cur_molecule_address, false])) {
        cur_molecule_address.push(false);
        cur_molecule_view.updateTarget();
      }
    }

    if (input.keyboard.wasPressed(KeyCode.KeyL)) {
      // delete vau
      if (cur_vaus.length > 1) {
        cur_vaus.splice(cur_vau_index, 1);
        save_cur_level();
        if (cur_vau_index === cur_vaus.length) {
          cur_vau_index -= 1;
          vau_index_visual_offset -= 1;
        }
      }
    }
    if (input.keyboard.wasPressed(KeyCode.KeyI)) {
      if (cur_vau_index > 0) {
        cur_vau_index -= 1;
        vau_index_visual_offset -= 1;
      } else {
        cur_vaus.unshift(cloneSexpr(default_vau) as Pair);
        save_cur_level();
      }
    }
    if (input.keyboard.wasPressed(KeyCode.KeyK)) {
      if (cur_vau_index + 1 < cur_vaus.length) {
        cur_vau_index += 1;
        vau_index_visual_offset += 1;
      } else {
        cur_vaus.push(cloneSexpr(default_vau) as Pair);
        save_cur_level();
        cur_vau_index += 1;
        vau_index_visual_offset += 1;
      }
    }

    const digits = [
      KeyCode.Digit1,
      KeyCode.Digit2,
      KeyCode.Digit3,
      KeyCode.Digit4,
      KeyCode.Digit5,
      KeyCode.Digit6,
      KeyCode.Digit7,
      KeyCode.Digit8,
      KeyCode.Digit9,
    ];
    digits.forEach((key, k) => {
      if (input.keyboard.wasPressed(key)) {
        console.log(cur_molecule_address);
        cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, { type: "atom", value: k.toString() });
      }
    });
    if (input.keyboard.wasPressed(KeyCode.Digit0)) {
      cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, {
        type: "pair",
        left: { type: "atom", value: "0" },
        right: { type: "atom", value: "0" },
      });
    }


  }
  if (cur_vaus.length === 0) {
    cur_vaus.push(cloneSexpr(default_vau) as Pair);
    save_cur_level();
  }
  const cur_vau = cur_vaus[cur_vau_index];

  if (ALLOW_KEYBOARD_INPUT && canInteract()) {
    if (input.keyboard.wasPressed(KeyCode.KeyZ)) {
      // apply current vau to current molecule
      const new_molecule = afterVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
      if (new_molecule !== null) {
        cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule.new_molecule);
      }
    } else if (input.keyboard.wasPressed(KeyCode.KeyX)) {
      // apply current vau to whole molecule
      const bind_result = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
      if (bind_result !== null) {
        cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, bind_result.new_molecule);
      }
    } else if (input.keyboard.wasPressed(KeyCode.KeyC)) {
      // apply all vaus to whole molecule until one works
      for (let k = 0; k < cur_vaus.length; k++) {
        const bind_result = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vaus[k]);
        if (bind_result !== null) {
          cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, bind_result.new_molecule);
          break;
        }
      }
    } else if (input.keyboard.wasPressed(KeyCode.KeyV)) {
      // apply all vaus to whole molecule until one works, until none of them work
      let any_changes = true;
      while (any_changes) {
        any_changes = false;
        for (let k = 0; k < cur_vaus.length; k++) {
          const bind_result = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vaus[k]);
          if (bind_result !== null) {
            cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, bind_result.new_molecule);
            any_changes = true;
            break;
          }
        }
      }
      // } else if (input.keyboard.wasPressed(KeyCode.KeyB)) {
      //   // same as Z but with animation
      //   const bind_result = afterVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
      //   if (bind_result !== null) {
      //     animate({
      //       bindings: bind_result.bindings,
      //       new_molecule: bind_result.new_molecule,
      //       bound_at: []
      //     }, cur_vau);
      //   }
      // } else if (input.keyboard.wasPressed(KeyCode.KeyN)) {
      //   // same as X (cur vau, whole molecule) but with animation
      //   const bind_result = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
      //   if (bind_result !== null) {
      //     animate(bind_result, cur_vau);
      //   }
      // } else if (input.keyboard.wasPressed(KeyCode.KeyM)) {
      //   // anywhere in the molecule, with animation
      //   let old_address = cur_molecule_address;
      //   cur_molecule_address = [];
      //   const bind_result = afterRecursiveVau(cur_base_molecule, cur_vau);
      //   if (bind_result !== null) {
      //     animate(bind_result, cur_vau);
      //   } else {
      //     cur_molecule_address = old_address;
      //   }
    } else if (input.keyboard.wasPressed(KeyCode.Space)) {
      // any vau, anywhere in the molecule, with animation
      for (let k = 0; k < cur_vaus.length; k++) {
        const bind_result = afterRecursiveVau(cur_base_molecule, cur_vaus[k]);
        if (bind_result !== null) {
          cur_molecule_view.animateToAdress(bind_result.bound_at);
          vau_index_visual_offset += k - cur_vau_index;
          cur_vau_index = k;
          let vau = cur_vaus[k];
          doWhen(() => animate(bind_result, vau, false),
            () => vau_index_visual_offset === 0);
          break;
        }
      }
    }
  }

  const mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);

  // TODO: animate view selection at the same time as vau selection

  pending_dowhens = pending_dowhens.filter(({ action, condition }) => {
    if (condition()) {
      action();
      return false;
    }
    return true;
  })

  ctx.lineWidth = 2 * _1;
  if (animation_state === null) {
    drawMolecule(cur_base_molecule, advanceAnim(cur_molecule_view.anim, delta_time));
  } else {
    drawMoleculeDuringAnimation(cur_base_molecule, advanceAnim(cur_molecule_view.anim, delta_time), []);
  }
  drawMolecule(cur_target, target_view);
  if (animation_state !== null) {
    drawVauDuringAnimtion(cur_vau, advanceAnim(animation_state.animating_vau_view, animation_state.speed * delta_time));
    if (animation_state.floating_binds !== null) {
      animation_state.floating_binds.forEach(({ binding, view }) => {
        drawMolecule(binding.value, advanceAnim(view, animation_state!.speed * delta_time));
        drawBigBind(binding.name, advanceAnim(view, 0));
      })
    }
    if (animation_state.animating_vau_view.progress >= 1) {
      cur_base_molecule = animation_state.transformed_base_molecule;
      animation_state = null;
    }
  } else {
    drawVau(cur_vau, offsetVauView(base_vau_view, vau_index_visual_offset));
  }
  cur_vaus.forEach((vau, k) => {
    if (k !== cur_vau_index) {
      drawVau(vau, offsetVauView(base_vau_view, k - cur_vau_index + vau_index_visual_offset));
    }
  })
  vau_index_visual_offset = towards(vau_index_visual_offset, 0, Math.ceil(Math.abs(vau_index_visual_offset) * .8 + .1) * delta_time / .2);

  toolbar_atoms.forEach(({ view, value }) => drawMolecule(value, view));
  toolbar_templates.forEach(({ view, value }) => drawMatcher(value, view));

  // vau toolbar
  if (.15 > (vauToolbarRect(cur_vau_index - vau_index_visual_offset).left / canvas_size.x)) vau_toolbar_offset += _1 * delta_time;
  if (.85 < (vauToolbarRect(cur_vau_index - vau_index_visual_offset).right / canvas_size.x)) vau_toolbar_offset -= _1 * delta_time;
  // vau_toolbar_offset = 0;
  cur_vaus.forEach((vau, k) => {
    drawVau(vau, {
      pos: canvas_size.mulXY(.1 + k * .1 + vau_toolbar_offset, .95),
      halfside: base_vau_view.halfside * .15
    })
  });
  strokeRect(ctx, vauToolbarRect(cur_vau_index - vau_index_visual_offset))
  cur_vaus.forEach((_vau, k) => {
    let cur_rect = vauToolbarRect(k);
    if (canInteract() && cur_rect.contains(mouse_pos)) {
      ctx.strokeStyle = "cyan";
      strokeRect(ctx, cur_rect);
      ctx.strokeStyle = "black";
      if (input.mouse.wasPressed(MouseButton.Left)) {
        vau_index_visual_offset += k - cur_vau_index;
        cur_vau_index = k;
      }
    }
  });
  if (vau_index_visual_offset === 0) {
    let base_rect = vauToolbarRect(cur_vau_index);
    let asdf = Rectangle.fromParams({ bottomLeft: base_rect.topLeft, size: base_rect.size.scale(1 / 3) });
    asdf.topLeft = asdf.topLeft.subX(asdf.size.x);
    if (button("+", asdf)) {
      cur_vaus.splice(cur_vau_index, 0, cloneSexpr(cur_vau) as Pair);
      cur_vau_index += 1;
      save_cur_level();
    }
    asdf.topLeft = asdf.topLeft.addX(asdf.size.x);
    if (cur_vau_index > 0 && button("<", asdf)) {
      let temp = cur_vaus[cur_vau_index];
      cur_vaus[cur_vau_index] = cur_vaus[cur_vau_index - 1];
      cur_vaus[cur_vau_index - 1] = temp;
      cur_vau_index -= 1;
      save_cur_level();
    }
    asdf.topLeft = asdf.topLeft.addX(asdf.size.x);
    if (cur_vaus.length > 1 && button("X", asdf)) {
      cur_vaus.splice(cur_vau_index, 1);
      if (cur_vau_index === cur_vaus.length) {
        cur_vau_index -= 1;
      }
      save_cur_level();
    }
    asdf.topLeft = asdf.topLeft.addX(asdf.size.x);
    if ((cur_vau_index + 1) < cur_vaus.length && button(">", asdf)) {
      let temp = cur_vaus[cur_vau_index];
      cur_vaus[cur_vau_index] = cur_vaus[cur_vau_index + 1];
      cur_vaus[cur_vau_index + 1] = temp;
      cur_vau_index += 1;
      save_cur_level();
    }
    asdf.topLeft = asdf.topLeft.addX(asdf.size.x);
    if (button("+", asdf)) {
      cur_vaus.splice(cur_vau_index + 1, 0, cloneSexpr(cur_vau) as Pair);
      save_cur_level();
    }
  }
  if (button("+", Rectangle.fromParams({ bottomLeft: canvas_size.mulXY(vau_toolbar_offset, 1), size: Vec2.both(50 * _1) }))) {
    cur_vaus.unshift(cloneSexpr(default_vau) as Pair);
    cur_vau_index += 1;
    save_cur_level();
  }
  if (button("+", Rectangle.fromParams({ bottomLeft: canvas_size.mulXY(.06 + .1 * cur_vaus.length + vau_toolbar_offset, 1), size: Vec2.both(50 * _1) }))) {
    cur_vaus.push(cloneSexpr(default_vau) as Pair);
    save_cur_level();
  }

  {
    // menu button
    if (button("Menu", Rectangle.fromParams({ topRight: canvas_size.mulXY(1, 0), size: new Vec2(150, 50).scale(_1) }))) {
      save_cur_level();
      // recalcScores(cur_level);
      STATE = "menu"
      return;
    }
  }

  if (isValidVau(cur_vau)) {
    // timeline controls
    if (button("Test", Rectangle.fromParams({
      topRight: new Vec2(canvas_size.x - 25 * _1, 150 * _1),
      size: new Vec2(100, 50).scale(_1)
    }))) {
      testing_animation_state = { test_case_n: 0, cur_iters: 0, total_iters: 0 };
      cur_test_case = testing_animation_state.test_case_n;
      [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
      cur_molecule_address = [];
      cur_molecule_view.instantlyUpdateTarget();
    }

    if (animation_state !== null && animation_state.speed === 0) {
      strokeRect(ctx, Rectangle
        .fromParams({ topRight: new Vec2(canvas_size.x - 175 * _1, 75 * _1), size: new Vec2(50, 50).scale(_1) })
        .resized(new Vec2(75, 75).scale(_1), "center"));
    }
    if (alwaysInteractableButton(">|", Rectangle.fromParams({ topRight: new Vec2(canvas_size.x - 175 * _1, 75 * _1), size: new Vec2(50, 50).scale(_1) }))
      && vau_index_visual_offset === 0 && testing_animation_state === null) {
      if (animation_state === null) {
        // any vau, anywhere in the molecule, with paused animation
        for (let k = 0; k < cur_vaus.length; k++) {
          let bind_result = afterRecursiveVau(cur_base_molecule, cur_vaus[k]);
          if (null !== bind_result) {
            if (k !== cur_vau_index || !eqArrays(bind_result.bound_at, cur_molecule_address)) {
              // step 1: move to the correct vau and view
              vau_index_visual_offset += k - cur_vau_index;
              cur_vau_index = k;
              cur_molecule_view.animateToAdress(bind_result.bound_at);
            } else {
              // step 2: animate until bind
              animate(bind_result, cur_vau, true);
            }
            break;
          }
        }
      } else {
        // step 3: animate after bind
        animation_state.speed = 1;
      }
    }
    if (button(">", Rectangle.fromParams({ topRight: new Vec2(canvas_size.x - 100 * _1, 75 * _1), size: new Vec2(50, 50).scale(_1) }))) {
      // any vau, anywhere in the molecule, with animation
      for (let k = 0; k < cur_vaus.length; k++) {
        const bind_result = afterRecursiveVau(cur_base_molecule, cur_vaus[k]);
        if (bind_result !== null) {
          cur_molecule_view.animateToAdress(bind_result.bound_at);
          vau_index_visual_offset += k - cur_vau_index;
          cur_vau_index = k;
          let vau = cur_vaus[k];
          doWhen(() => animate(bind_result, vau, false, 2),
            () => vau_index_visual_offset === 0);
          break;
        }
      }
    }
    if (continousAlwaysInteractableButton(">>", Rectangle.fromParams({ topRight: new Vec2(canvas_size.x - 25 * _1, 75 * _1), size: new Vec2(50, 50).scale(_1) }))
      && canInteract()) {
      // apply 1 vau fast
      for (let k = 0; k < cur_vaus.length; k++) {
        const bind_result = afterRecursiveVau(cur_base_molecule, cur_vaus[k]);
        if (bind_result !== null) {
          cur_molecule_view.animateToAdress(bind_result.bound_at);
          // vau_index_visual_offset += k - cur_vau_index;
          vau_index_visual_offset = 0;
          cur_vau_index = k;
          let vau = cur_vaus[k];
          animate(bind_result, vau, false, 5);
          break;
        }
      }
    }
  } else {
    fillText(ctx, "invalid vau", new Vec2(canvas_size.x - 175 * _1, 75 * _1));
  }

  {
    // select test case
    if (cur_test_case > 0) {
      if (button("<", Rectangle.fromParams({ topLeft: new Vec2(0, 0), size: new Vec2(50, 50).scale(_1) }))) {
        cur_test_case -= 1;
        [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
        cur_molecule_address = [];
        cur_molecule_view.instantlyUpdateTarget();
        failed_cur_test = false;
      }
    }
    if (button(">", Rectangle.fromParams({ topLeft: new Vec2(150, 0).scale(_1), size: new Vec2(50, 50).scale(_1) }))) {
      cur_test_case += 1;
      [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
      cur_molecule_address = [];
      cur_molecule_view.instantlyUpdateTarget();
      failed_cur_test = false;
    }

    ctx.fillStyle = failed_cur_test ? "red" : (eqSexprs(cur_base_molecule, cur_target) ? "lime" : "black");
    fillText(ctx, `Test ${cur_test_case}`, new Vec2(100, 25).scale(_1));
  }

  if (testing_animation_state !== null) {
    if (animation_state === null && vau_index_visual_offset === 0) {
      if (testing_animation_state.cur_iters > 100) {
        // Too many iterations!
        testing_animation_state = null;
      } else if (eqSexprs(cur_base_molecule, cur_target)) {
        // solved the test case
        if (testing_animation_state.test_case_n < N_TESTS) {
          testing_animation_state.test_case_n += 1;
          testing_animation_state.total_iters += testing_animation_state.cur_iters;
          testing_animation_state.cur_iters = 0;
          cur_test_case = testing_animation_state.test_case_n;
          [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
          cur_molecule_address = [];
          cur_molecule_view.instantlyUpdateTarget();
        } else {
          cur_level.user_slots[cur_solution_slot].stats = {
            n_vaus: cur_vaus.length,
            n_steps: testing_animation_state.total_iters / N_TESTS,
            n_colors: new Set(cur_vaus.flatMap(allAtoms)).size,
          }
          testing_animation_state = null;
          save_cur_level();
          STATE = "menu";
        }
      } else {
        // apply another vau
        let any_changes = false;
        for (let k = 0; k < cur_vaus.length; k++) {
          const bind_result = afterRecursiveVau(cur_base_molecule, cur_vaus[k]);
          if (bind_result !== null) {
            cur_molecule_view.animateToAdress(bind_result.bound_at);
            // vau_index_visual_offset += k - cur_vau_index;
            vau_index_visual_offset = 0;
            cur_vau_index = k;
            let vau = cur_vaus[k];
            animate(bind_result, vau, false, 100);
            any_changes = true;
            break;
          }
        }
        if (!any_changes) {
          // failed test case
          failed_cur_test = true;
          testing_animation_state = null;
        } else {
          testing_animation_state.cur_iters += 1;
        }
      }
    }
  }

  if (testing_animation_state !== null) {
    ctx.globalAlpha = .7;
    ctx.fillStyle = COLORS.background.toHex();
    ctx.fillRect(0, 0, canvas_size.x, canvas_size.y);
    ctx.globalAlpha = 1;
  }

  let cur_mouse_place: MoleculePlace;
  {
    const molecule_mouse_path = moleculeAdressFromScreenPosition(
      mouse_pos,
      cur_base_molecule,
      cur_molecule_view.cur
    );
    const vau_molecule_mouse_path = moleculeAdressFromScreenPosition(
      mouse_pos,
      cur_vau.right,
      getVauMoleculeView(base_vau_view)
    );
    const vau_matcher_mouse_path = matcherAdressFromScreenPosition(
      mouse_pos,
      cur_vau.left,
      base_vau_view
    );
    const hovering_atom_toolbar_index: number | null = findIndex(toolbar_atoms, ({ view, value }) => {
      return moleculeAdressFromScreenPosition(mouse_pos, value, view) !== null;
    });
    const hovering_template_toolbar_index: number | null = findIndex(toolbar_templates, ({ view, value, used }) => {
      return !used && matcherAdressFromScreenPosition(mouse_pos, value, view) !== null;
    });
    if (hovering_atom_toolbar_index !== null) {
      cur_mouse_place = { type: "toolbar_atoms", atom_index: hovering_atom_toolbar_index };
    } else if (hovering_template_toolbar_index !== null) {
      cur_mouse_place = { type: "toolbar_templates", template_index: hovering_template_toolbar_index };
    } else if (vau_molecule_mouse_path !== null) {
      cur_mouse_place = { type: "vau_molecule", vau_molecule_address: vau_molecule_mouse_path };
    } else if (vau_matcher_mouse_path !== null) {
      cur_mouse_place = { type: "vau_matcher", vau_matcher_address: vau_matcher_mouse_path };
    } else if (molecule_mouse_path !== null) {
      cur_mouse_place = { type: "molecule", molecule_address: molecule_mouse_path };
    } else {
      cur_mouse_place = { type: "none" };
    }

    if (!canInteract()) {
      cur_mouse_place = { type: "none" };
    }
  }
  if (cur_mouse_place.type === "molecule" && input.mouse.wasPressed(MouseButton.Right)) {
    cur_molecule_view.animateToAdress(cur_mouse_place.molecule_address);
  }
  switch (mouse_state.type) {
    case "none": {
      switch (cur_mouse_place.type) {
        case "none":
          break;
        case "molecule":
          drawMoleculeHighlight(getAtAddress(cur_base_molecule, cur_mouse_place.molecule_address), getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_base_molecule, cur_mouse_place.molecule_address) };
          }
          break;
        case "vau_molecule":
          drawMoleculeHighlight(getAtAddress(cur_vau.right, cur_mouse_place.vau_molecule_address), getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_vau.right, cur_mouse_place.vau_molecule_address) };
          }
          break;
        case "vau_matcher":
          drawMatcherHighlight(getAtAddress(cur_vau.left, cur_mouse_place.vau_matcher_address), getMatcherGrandchildView(base_vau_view, cur_mouse_place.vau_matcher_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_vau.left, cur_mouse_place.vau_matcher_address) };
          }
          break;
        case "toolbar_atoms":
          drawMoleculeHighlight(toolbar_atoms[cur_mouse_place.atom_index].value, toolbar_atoms[cur_mouse_place.atom_index].view, "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: toolbar_atoms[cur_mouse_place.atom_index].value };
          }
          break;
        case "toolbar_templates":
          drawMatcherHighlight(toolbar_templates[cur_mouse_place.template_index].value, toolbar_templates[cur_mouse_place.template_index].view, "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: toolbar_templates[cur_mouse_place.template_index].value };
          }
          break;
        default:
          throw new Error("");
      }
      break;
    }
    case "holding": {
      switch (mouse_state.source.type) {
        case "molecule":
          drawMoleculeHighlight(mouse_state.value, getGrandchildView(cur_molecule_view.cur, mouse_state.source.molecule_address), "blue");
          break;
        case "vau_molecule":
          drawMoleculeHighlight(mouse_state.value, getGrandchildView(getVauMoleculeView(base_vau_view), mouse_state.source.vau_molecule_address), "blue");
          break;
        case "vau_matcher":
          drawMatcherHighlight(mouse_state.value, getMatcherGrandchildView(base_vau_view, mouse_state.source.vau_matcher_address), "blue");
          break;
        case "toolbar_atoms":
          drawMoleculeHighlight(mouse_state.value, getGrandchildView(toolbar_atoms[mouse_state.source.atom_index].view, []), "blue");
          break;
        case "toolbar_templates":
          drawMatcherHighlight(mouse_state.value, toolbar_templates[mouse_state.source.template_index].view, "blue");
          break;
        case "none":
        default:
          throw new Error("");
      }

      switch (cur_mouse_place.type) {
        case "toolbar_templates":
        case "toolbar_atoms":
        case "none":
          break;
        case "molecule":
          drawMoleculeHighlight(mouse_state.value, getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address), containsTemplate(mouse_state.value) ? "red" : "Chartreuse");
          ctx.globalAlpha = .5;
          drawMolecule(mouse_state.value, getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address));
          ctx.globalAlpha = 1;
          if (input.mouse.wasReleased(MouseButton.Left) && !containsTemplate(mouse_state.value)) {
            cur_base_molecule = setAtAddress(cur_base_molecule, cur_mouse_place.molecule_address, mouse_state.value);
          }
          break;
        case "vau_molecule":
          drawMoleculeHighlight(mouse_state.value, getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address), "Chartreuse");
          ctx.globalAlpha = .5;
          drawMolecule(mouse_state.value, getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address));
          ctx.globalAlpha = 1;
          if (input.mouse.wasReleased(MouseButton.Left)) {
            cur_vau.right = setAtAddress(cur_vau.right, cur_mouse_place.vau_molecule_address, mouse_state.value);
          }
          break;
        case "vau_matcher":
          drawMatcherHighlight(mouse_state.value, getMatcherGrandchildView(base_vau_view, cur_mouse_place.vau_matcher_address), "Chartreuse");
          ctx.globalAlpha = .5;
          drawMatcher(mouse_state.value, getMatcherGrandchildView(base_vau_view, cur_mouse_place.vau_matcher_address));
          ctx.globalAlpha = 1;
          if (input.mouse.wasReleased(MouseButton.Left)) {
            cur_vau.left = setAtAddress(cur_vau.left, cur_mouse_place.vau_matcher_address, mouse_state.value);
          }
          break;
        default:
          throw new Error("");
      }
      if (input.mouse.wasReleased(MouseButton.Left)) {
        mouse_state = { type: "none" };
      }
      break;
    }
    default:
      throw new Error("");
  }

  function vauToolbarRect(index: number): Rectangle {
    return Rectangle.fromParams({
      bottomLeft: canvas_size.mulXY(.06 + .1 * index + vau_toolbar_offset, 1),
      size: canvas_size.mulXY(.09, .1),
    });
  }
}

// (y_time, x_offset), with x_offset in terms of halfside
// (0, 0) & (1, 0) are implicit
type AtomProfile = Vec2[];
const atom_shapes = new DefaultMap<string, AtomProfile>((_) => [], new Map(Object.entries({
  "nil": [new Vec2(.75, -.25)],
  "input": [new Vec2(.2, .2), new Vec2(.8, .2)],
  "output": [new Vec2(.2, -.2), new Vec2(.8, -.2)],
  "true": fromCount(10, k => {
    let t = k / 10;
    return new Vec2(t, -.2 * Math.sin(t * Math.PI));
  }),
  "false": [new Vec2(1 / 6, .2), new Vec2(.5, -.2), new Vec2(5 / 6, .2)],
  "v1": [new Vec2(.2, .2), new Vec2(.4, -.2), new Vec2(.7, .2)],
  // "v2": [new Vec2(.1, 0), new Vec2(.3, -.2), new Vec2(.5, 0), new Vec2(.8, .2), new Vec2(.95, 0)],
  // "v2": [new Vec2(.2, 0), new Vec2(.5, .2), new Vec2(.8, 0)],
  // "v2": fromCount(3, k => {
  //   let x2 = (k+1)/3;
  //   let x1 = x2 - .05;
  //   if (k === 2) {
  //     return [new Vec2(x1, .2 - x1 * .1)];
  //   } else {
  //     return [new Vec2(x1, .2 - x1 * .1), new Vec2(x2, - x2 * .1)];
  //   }
  // }).flat(1),
  "v2": fromCount(3, k => {
    let d = .05;
    let raw = [new Vec2(k / 3, 0), new Vec2((k + 1) / 3 - d, .2), new Vec2((k + 1) / 3 - d / 2, .1)];

    let transform = Vec2.findTransformationWithFixedOrigin({ source: new Vec2(1 - d / 2, .1), target: new Vec2(1, 0) });
    return raw.map(transform);
  }).flat(1),
  // "v2": [new Vec2(.25, .2), new Vec2(.3, 0), new Vec2(.55, .2), new Vec2(.6, 0), new Vec2(.85, .2), new Vec2(.9, 0)],
  "v3": fromCount(2, k => {
    let c = (2 * k + 1) / 4;
    let s = .6 / 4;
    return [new Vec2(c - s, 0), new Vec2(c, -.25), new Vec2(c + s, 0)];
  }).flat(1),
  // "f1": [new Vec2(.3, -.2), new Vec2(.5, 0), new Vec2(.8, .2)],
  "f1": [new Vec2(.3, -.2), new Vec2(.4, -.07), new Vec2(.5, .03), new Vec2(.6, .1), new Vec2(.7, .17), new Vec2(.8, .2), new Vec2(.85, .2)],
  // "f1": [new Vec2(.3, -.2), new Vec2(.4, -.05), new Vec2(.5, .05), new Vec2(.6, .15), new Vec2(.8, .2)],
  // "f1": [new Vec2(.5, .25)],
})));

function animate(
  bind_result: { bound_at: Address; new_molecule: Sexpr; bindings: Binding[]; },
  cur_vau: Pair,
  pause_after_binding: boolean,
  speed: number = 1,
) {
  failed_cur_test = false;
  let bind_targets = bind_result.bindings.map(b => {
    return {
      binding: b,
      targets: findBindingTargets(cur_vau.right, b, []),
    };
  });
  animation_state = {
    speed: speed,
    molecule_fade: 0,
    binds_done: false,
    vau_molecule_opacity: 1,
    molecule_address: bind_result.bound_at,
    floating_binds: null,
    failed_bind_names: bind_targets.filter(({ targets }) => targets.length === 0).map(({ binding }) => binding.name),
    animating_vau_view: {
      progress: 0,
      duration: 2.0,
      callback: t => {
        if (animation_state === null) throw new Error("");
        if (t < 1 / 3) {
          t = remap(t, 0, 1 / 3, 0, 1);
          // animation_state.new_molecule_opacity = clamp(remap(t, .5, 1, 0, 1), 0, 1);
          return {
            halfside: base_vau_view.halfside,
            pos: Vec2.lerp(base_vau_view.pos, base_molecule_view.pos.addX(base_molecule_view.halfside * 3), t),
          };
        } else if (t < 2 / 3) {
          t = remap(t, 1 / 3, 2 / 3, 0, 1);
          animation_state.molecule_fade = t;
          if (animation_state.floating_binds === null) {
            animation_state.floating_binds = bind_result.bindings.flatMap(b => {
              return bind_targets.find(x => x.binding === b)!.targets.map(target => {
                return {
                  binding: b,
                  view: makeLerpAnim(
                    getGrandchildView(base_molecule_view, b.address),
                    getGrandchildView({
                      pos: base_molecule_view.pos.addX(base_molecule_view.halfside * 3.25),
                      halfside: base_molecule_view.halfside,
                    }, target),
                    1.9 / 3,
                    lerpMoleculeViews
                  )
                };
              });
            });
            if (pause_after_binding) {
              animation_state.speed = 0;
            }
          }
          return {
            halfside: base_vau_view.halfside,
            pos: base_molecule_view.pos.add(new Vec2(base_molecule_view.halfside * 3, -t * base_vau_view.halfside / 2)),
          };
        } else {
          let start_vau_view: VauView = {
            halfside: base_vau_view.halfside,
            pos: base_molecule_view.pos.add(new Vec2(base_molecule_view.halfside * 3, -base_vau_view.halfside / 2)),
          };
          animation_state.molecule_fade = 1;
          animation_state.floating_binds = null;
          animation_state.binds_done = true;
          // let start_molecule_view: MoleculeView = getVauMoleculeView(start_vau_view);
          t = remap(t, 2 / 3, 1, 0, 1);
          animation_state.vau_molecule_opacity = 1 - t;
          return {
            halfside: base_vau_view.halfside,
            pos: Vec2.lerp(start_vau_view.pos, base_molecule_view.pos.sub(new Vec2(spike_perc * base_vau_view.halfside / 2, base_vau_view.halfside / 2)), t),
          };
        }
      }
    },
    transformed_base_molecule: bind_result.new_molecule,
  };
}

let pending_dowhens: { action: () => void, condition: () => boolean }[] = [];
function doWhen(action: () => void, condition: () => boolean) {
  pending_dowhens.push({ action, condition });
}

// library stuff /////////////////////////

function single<T>(arr: T[]): T {
  if (arr.length === 0) {
    throw new Error("the array was empty");
  } else if (arr.length > 1) {
    throw new Error(`the array had more than 1 element: ${arr.toString()}`);
  } else {
    return arr[0];
  }
}

function at<T>(arr: T[], index: number): T {
  if (arr.length === 0) throw new Error("can't call 'at' with empty array");
  return arr[mod(index, arr.length)];
}

const loading_screen_element = document.querySelector<HTMLDivElement>("#loading_screen");
if (loading_screen_element !== null) {
  loading_screen_element.innerText = "Press to start!";
  document.addEventListener("pointerdown", _event => {
    loading_screen_element.style.opacity = "0";
    requestAnimationFrame(every_frame);
  }, { once: true });
} else {
  requestAnimationFrame(every_frame);
}
