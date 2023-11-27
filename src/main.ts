import GUI from "lil-gui";
import { Input, KeyCode, Mouse, MouseButton } from "./kommon/input";
import { Color, NaiveSpriteGraphics, ShakuStyleGraphics, initCtxFromSelector, initGlFromSelector } from "./kommon/kanvas";
import { DefaultMap, eqArrays, findIndex, fromCount, objectMap, reversed, reversedForEach, zip2 } from "./kommon/kommon";
import { Rectangle, Vec2, mod, towards as approach, lerp, inRange, rand05 } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";
import Rand, { PRNG } from 'rand-seed';

import grammar from "./sexpr.pegjs?raw"
import * as peggy from "peggy";

const COLORS = {
  background: Color.fromInt(0x6e6e6e),
  cons: Color.fromInt(0x404040),
};

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


const input = new Input();
const gl = initGlFromSelector("#gl_canvas");
const ctx = initCtxFromSelector("#ctx_canvas");
const canvas = gl.canvas as HTMLCanvasElement;
gl.clearColor(...COLORS.background.toArray());
const canvas_size = new Vec2(canvas.width, canvas.height);

const gfx = new NaiveSpriteGraphics(gl);
// const gfx2 = new ShakuStyleGraphics(gl);

const DEBUG = true;

// The variables we might want to tune while playing
const CONFIG = {
  tmp01: .5,
  tmp1: 1.0,
  tmp50: 50,
  tmp250: 250,
  tmp500: 500,
  color: "#000000",
};

if (DEBUG) {
  const gui = new GUI();
  gui.add(CONFIG, "tmp01", 0, 1);
  gui.add(CONFIG, "tmp-1", -1, 1);
  gui.add(CONFIG, "tmp50", 0, 100);
  gui.add(CONFIG, "tmp250", 0, 500);
  gui.add(CONFIG, "tmp500", 0, 1000);
  gui.addColor(CONFIG, "color");
  gui.domElement.style.bottom = "0px";
  gui.domElement.style.top = "auto";
  // gui.hide();
}

function myFillText(ctx: CanvasRenderingContext2D, text: string, pos: Vec2) {
  text.split('\n').forEach((line, k) => {
    ctx.fillText(line, pos.x, pos.y + k * 30);
  })
}

function fillText(ctx: CanvasRenderingContext2D, text: string, pos: Vec2) {
  ctx.fillText(text, pos.x, pos.y);
}

function fillRect(ctx: CanvasRenderingContext2D, rect: Rectangle) {
  ctx.fillRect(rect.topLeft.x, rect.topLeft.y, rect.size.x, rect.size.y);
}

function moveTo(ctx: CanvasRenderingContext2D, { x, y }: Vec2) {
  ctx.moveTo(x, y);
}
function lineTo(ctx: CanvasRenderingContext2D, { x, y }: Vec2) {
  ctx.lineTo(x, y);
}

// let spike_perc = CONFIG.tmp01;
let spike_perc = 1 / 3;

// actual game logic
let cur_base_molecule = parseSexpr("(+  (1 1 1) . (+ (1 1) . (1)))");
let cur_target = parseSexpr("(1 1 1 1 1 1)");
let cur_molecule_address = [] as Address;
const base_molecule_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.1, .5)),
  halfside: 150,
};
const target_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.2, .9)),
  halfside: 35,
};

const base_vau_view: VauView = {
  pos: canvas_size.mul(new Vec2(.7, .5)).addX(CONFIG.tmp250 - 250),
  halfside: 150,
};

const top_vau_view: VauView = { pos: base_vau_view.pos.subY(canvas_size.y * .5), halfside: base_vau_view.halfside };
const bottom_vau_view: VauView = { pos: base_vau_view.pos.addY(canvas_size.y * .5), halfside: base_vau_view.halfside };

const default_vau: Pair = parseSexpr(`(
  (1 . @2)
  .
  (@2 . 1)
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

function afterVau(molecule: Sexpr, vau: Pair): Sexpr | null {
  const bindings = generateBindings(molecule, vau.left);
  if (bindings === null) return null;
  return applyBindings(vau.right, bindings);
}

function afterRecursiveVau(molecule: Sexpr, vau: Pair): Sexpr | null {
  let addresses_to_try: Address[] = [[]];
  while (addresses_to_try.length > 0) {
    const cur_address = addresses_to_try.shift()!;
    const cur_molecule = getAtAddress(molecule, cur_address);
    const result = afterVau(cur_molecule, vau);
    if (result !== null) {
      return setAtAddress(molecule, cur_address, result);
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
function drawMolecule(data: Sexpr, view: MoleculeView) {
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      ctx.beginPath();
      ctx.globalAlpha = .5;
      ctx.fillStyle = colorFromAtom(data.value.slice(1)).toHex();
      moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-view.halfside));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
      lineTo(ctx, view.pos.addY(view.halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
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

    drawMolecule(data.left, getChildView(view, true));
    drawMolecule(data.right, getChildView(view, false));
  }
}

function drawMoleculeHighlight(view: MoleculeView, color: string) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
  lineTo(ctx, view.pos.addY(-view.halfside));
  lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
  lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
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
  if (inRange(delta_pos.y, -1, 1) && inRange(delta_pos.x, (Math.abs(delta_pos.y) - 1) * spike_perc, 2)) {
    // are we selecting a subchild?
    if (data.type === "pair" && delta_pos.x >= .5 - spike_perc / 2) {
      const is_left = delta_pos.y <= 0;
      const maybe_child = moleculeAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getChildView(view, is_left));
      if (maybe_child !== null) {
        return [is_left, ...maybe_child];
      }
    }
    // no subchild, path to this
    return [];
  } else {
    return null;
  }
}

function matcherAdressFromScreenPosition(screen_pos: Vec2, data: Sexpr, view: VauView): Address | null {
  const delta_pos = screen_pos.sub(view.pos).scale(1 / view.halfside);
  if (inRange(delta_pos.y, -1, 1) && inRange(delta_pos.x, -3 + (Math.abs(delta_pos.y) - 1) * spike_perc, -(Math.abs(delta_pos.y) - 1) * spike_perc)) {
    // are we selecting a subchild?
    if (data.type === "pair" && -delta_pos.x >= .5 - spike_perc / 2) {
      const is_left = delta_pos.y <= 0;
      const maybe_child = matcherAdressFromScreenPosition(screen_pos, is_left ? data.left : data.right, getMatcherChildView(view, is_left));
      if (maybe_child !== null) {
        return [is_left, ...maybe_child];
      }
    }
    // no subchild, path to this
    return [];
  } else {
    return null;
  }
}

type VauView = { pos: Vec2, halfside: number };
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

function drawMatcherHighlight(view: VauView, color: string) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  moveTo(ctx, view.pos.addX(view.halfside * spike_perc));
  lineTo(ctx, view.pos.addY(-view.halfside));
  lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, -view.halfside)));
  lineTo(ctx, view.pos.addX(-view.halfside * (3 + spike_perc)));
  lineTo(ctx, view.pos.add(new Vec2(-view.halfside * 3, view.halfside)));
  lineTo(ctx, view.pos.addY(view.halfside));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "black";
}


function drawMatcher(data: Sexpr, view: VauView) {
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      const halfside = view.halfside;
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value.slice(1)).toHex();
      ctx.globalAlpha = .5;
      moveTo(ctx, view.pos.addX(halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-halfside));
      lineTo(ctx, view.pos.add(new Vec2(-halfside * 3, -halfside)));
      lineTo(ctx, view.pos.addX(-halfside * 3 - halfside * spike_perc));
      lineTo(ctx, view.pos.add(new Vec2(-halfside * 3, halfside)));
      lineTo(ctx, view.pos.addY(halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.globalAlpha = 1;
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

    drawMatcher(data.left, getMatcherChildView(view, true));
    drawMatcher(data.right, getMatcherChildView(view, false));
  }
  // drawVau_matcher(data.left, view);
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
  lerp: lerpMoleculeViews,
  duration: .1,
  setTarget: function (v: MoleculeView): void {
    this.anim = makeLerpAnim(getFinalValue(this.anim), v, this.duration, this.lerp);
  },
  anim: makeConstantAnim(base_molecule_view),
  updateTarget: function (): void {
    let new_target = getGrandparentView(base_molecule_view, cur_molecule_address);
    this.setTarget(new_target);
  },
  get cur(): MoleculeView {
    return this.anim.callback(this.anim.progress);
  }
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

const toolbar_atoms: { view: MoleculeView, value: Sexpr }[] = fromCount(11, k => {
  return { view: { pos: new Vec2(40 + 60 * k, 40), halfside: 20 }, value: k === 0 ? doPair(doAtom("0"), doAtom("0")) : doAtom((k - 1).toString()) }
});

const toolbar_templates: { view: VauView, value: Sexpr, used: boolean }[] = fromCount(7, k => {
  return { view: { pos: new Vec2(100 + 95 * k, 100), halfside: 20 }, value: doAtom(`@${k}`), used: false };
});

function doList(values: Sexpr[]): Sexpr {
  let result = doAtom('0') as Sexpr;
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
};

// let STATE: {
//   type: "menu",
//   selected_level_index: number | null,
//   selected_solution_slot: number | null,
// } | { type: "game" } = { type: "menu", selected_level_index: null, selected_solution_slot: null };
let STATE: "menu" | "game" = "menu";
let selected_level_index: number | null = null;
let selected_menu_test: number = 0

let cur_level: Level;

let levels: Level[] = [
  new Level(
    "anyred",
    "Spike Detector:\nSome of our neutral samples have been\ncontaminated with spiky proteins,\nmake a detector for any spiky bits.",
    (rand) => {
      let final_has_red = rand.next() > .5;
      function helper(has_red: boolean, depth: number): Sexpr {
        if (depth === 0) {
          if (has_red) {
            return doAtom('2');
          } else {
            return doAtom('3');
          }
        } else {
          let left_has_red = has_red && (rand.next() < .5);
          let right_has_red = has_red && (!left_has_red || (rand.next() < .2));
          return doPair(
            helper(left_has_red, depth - 1),
            helper(right_has_red, depth - 1),
          );
        }
      }
      return [
        helper(final_has_red, Math.floor(rand.next() * 3) + 2),
        doAtom(final_has_red ? '2' : '3'),
      ];
    }
  ),
  new Level(
    "add",
    "Peano Addition:\nWe can represent any natural number as\na list of ones! Make a vau to add them.",
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
    "List Reverse:\nReverse the given nil-terminated list.",
    (rand) => {
      const atoms = ['4', '5', '6', '7', '8'];
      function randomSexpr(max_depth: number): Sexpr {
        if (max_depth === 0) return doAtom(randomChoice(rand, atoms));
        return doPair(
          randomSexpr(Math.floor(rand.next() * max_depth)),
          randomSexpr(Math.floor(rand.next() * max_depth)),
        );
      }
      let asdf = fromCount(randomInt(rand, 0, 4), _ => randomSexpr(randomInt(rand, 1, 3)));
      return [
        doPair(
          doAtom('1'),
          doList(asdf),
        ),
        doList(reversed(asdf)),
      ]
    }
  ),
  new Level(
    "equal",
    "Equality Check:\nReturn spiky only if both molecules are equal.",
    (rand) => {
      let generate_equal = rand.next() > .5;
      const atoms = ['4', '5', '6'];
      function helper(equal: boolean, max_depth: number): [Sexpr, Sexpr] {
        if (max_depth === 0) {
          let v1 = randomChoice(rand, atoms);
          let v2 = randomChoice(rand, atoms);
          while (v2 === v1) {
            v2 = randomChoice(rand, atoms);
          }
          return [doAtom(v1), doAtom(equal ? v1 : v2)];
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
          doAtom('1'),
          doPair(...helper(generate_equal, Math.floor(rand.next() * 5))),
        ),
        doAtom(generate_equal ? '2' : '3'),
      ]
    }
  ),
  new Level(
    "lookup",
    "Lookup Table:\nGiven a list of (key, value) pairs and a key,\nreturn the value associated with it.",
    (rand) => {
      const atoms = ['4', '5', '6', '7', '8'];
      function randomSexpr(max_depth: number): Sexpr {
        if (max_depth === 0) return doAtom(randomChoice(rand, atoms));
        return doPair(
          randomSexpr(Math.floor(rand.next() * max_depth)),
          randomSexpr(Math.floor(rand.next() * max_depth)),
        );
      }
      let keys = randomChoiceWithoutRepeat(rand, atoms, randomInt(rand, 1, atoms.length));
      let dict_values = keys.map(v => doPair(doAtom(v), randomSexpr(4)));
      let selected = randomChoice(rand, dict_values);
      return [doPair(
        doAtom('1'),
        doPair(
          doList(dict_values),
          selected.left
        )
      ), selected.right]
    }
  ),
  new Level(
    "cadadar_easy",
    "CADADADAR easy",
    (rand) => {
      const atoms = ['5', '6', '7', '8'];
      function randomSexpr(max_depth: number, must_have: Address): Sexpr {
        if (max_depth < must_have.length) throw new Error("");
        if (max_depth === 0) return doAtom(randomChoice(rand, atoms));
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
          doAtom('1'),
          doPair(
            doList(address.map(v => doAtom(v ? '2' : '3'))),
            asdf
          )
        ),
        result
      ];
    }
  ),
  new Level(
    "cadadar_hard",
    "CADADADAR hard",
    (rand) => {
      const atoms = ['5', '6', '7', '8'];
      function randomSexpr(max_depth: number, must_have: Address): Sexpr {
        if (max_depth < must_have.length) throw new Error("");
        if (max_depth === 0) return doAtom(randomChoice(rand, atoms));
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
        problem = doPair(doAtom(v ? '2' : '3'), problem);
      });
      return [
        doPair(
          doAtom('1'),
          problem
        ),
        result
      ];
    }
  ),
];

function randomInt(rand: Rand, low_inclusive: number, high_exclusive: number): number {
  return low_inclusive + Math.floor(rand.next() * (high_exclusive - low_inclusive));
}

function randomChoiceWithoutRepeat<T>(rand: Rand, arr: T[], count: number) {
  if (count > arr.length) {
    throw new Error("array too small or count too big");
  }
  let result: T[] = [];
  while (result.length < count) {
    let cur = randomChoice(rand, arr);
    if (!result.includes(cur)) {
      result.push(cur);
    }
  }
  return result;
}

function randomChoice<T>(rand: Rand, arr: T[]) {
  if (arr.length === 0) {
    throw new Error("can't choose out of an empty array");
  }
  return arr[Math.floor(rand.next() * arr.length)];
}

{
  // load
  levels.forEach(level => {
    let stuff = window.localStorage.getItem(`knexator_vau_${level.id}`);
    if (stuff !== null) {
      level.user_slots = JSON.parse(stuff);
    }
  });
}

function save_cur_level() {
  window.localStorage.setItem(`knexator_vau_${cur_level.id}`, JSON.stringify(cur_level.user_slots));
}

function makePeanoSexpr(n: number): Sexpr {
  let result: Sexpr = doAtom('0');
  for (let k = 0; k < n; k++) {
    result = doPair(doAtom('1'), result);
  }
  return result;
}

function button(text: string, rect: Rectangle): boolean {
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
  spike_perc = CONFIG.tmp01;
  gl.clear(gl.COLOR_BUFFER_BIT);
  ctx.clearRect(0, 0, canvas.width, canvas.height);


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
    if (button(k.toString(), new Rectangle(new Vec2(50 + mod(k, 4) * 100, 50 + Math.floor(k / 4) * 100), Vec2.both(50)))) {
      selected_level_index = k;
    }
  }

  if (selected_level_index !== null) {
    let level = levels[selected_level_index]

    myFillText(ctx, level.description, canvas_size.mul(new Vec2(lerp(1/3, 3/4, .5), .5)));

    // menu sample select
    if (button('<', new Rectangle(canvas_size.mul(new Vec2(.02 + 1 / 3, .0)), new Vec2(canvas_size.x * .05, 25)))) {
      selected_menu_test -= 1;
    }

    if (button('>', Rectangle.fromParams({ topRight: canvas_size.mul(new Vec2(.75 - .02, .0)), size: new Vec2(canvas_size.x * .05, 25) }))) {
      selected_menu_test += 1;
    }
    let rand = new Rand(`menu_sample_${level.id}_${selected_menu_test}`);
    const origin_molecule_view: MoleculeView = { pos: canvas_size.mul(new Vec2(.4, .2)), halfside: canvas.height / 8 };
    const target_molecule_view: MoleculeView = { pos: canvas_size.mul(new Vec2(.6, .2)), halfside: canvas.height / 8 }
    const [origin, target] = level.generate_test(rand);
    drawMolecule(origin, origin_molecule_view);
    drawMolecule(target, target_molecule_view);

    level.user_slots.forEach((slot, k) => {
      if (button(slot.name, new Rectangle(new Vec2(canvas_size.x * .75, k * 75), new Vec2(canvas_size.x * .25, 50)))) {

        STATE = "game";
        cur_level = level;
        cur_vaus = slot.vaus;
        cur_vau_index = 0;
        cur_test_case = 0;
        [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
        return;
      }
    });

    {
      if (button("New solution", new Rectangle(new Vec2(canvas_size.x * .75, level.user_slots.length * 75), new Vec2(canvas_size.x * .25, 50)))) {
        level.user_slots.push({ name: `Solution ${level.user_slots.length}`, vaus: [] });
      }
    }
  }
}

ctx.font = `${Math.floor(canvas_size.x * .02).toString()}px Arial`;
ctx.textBaseline = "middle";
ctx.textAlign = "center";

function game_frame(delta_time: number) {
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
      }
    }
  }
  if (input.keyboard.wasPressed(KeyCode.KeyI)) {
    if (cur_vau_index > 0) {
      cur_vau_index -= 1;
    } else {
      cur_vaus.unshift(cloneSexpr(default_vau) as Pair);
      save_cur_level();
    }
  }
  if (input.keyboard.wasPressed(KeyCode.KeyK)) {
    if (cur_vau_index + 1 < cur_vaus.length) {
      cur_vau_index += 1;
    } else {
      cur_vaus.push(cloneSexpr(default_vau) as Pair);
      save_cur_level();
      cur_vau_index += 1;
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


  if (cur_vaus.length === 0) {
    cur_vaus.push(cloneSexpr(default_vau) as Pair);
    save_cur_level();
  }
  const cur_vau = cur_vaus[cur_vau_index];

  if (input.keyboard.wasPressed(KeyCode.KeyZ)) {
    // apply current vau to current molecule
    const new_molecule = afterVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
    if (new_molecule !== null) {
      cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
    }
  } else if (input.keyboard.wasPressed(KeyCode.KeyX)) {
    // apply current vau to whole molecule
    const new_molecule = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
    if (new_molecule !== null) {
      cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
    }
  } else if (input.keyboard.wasPressed(KeyCode.KeyC)) {
    // apply all vaus to whole molecule until one works
    for (let k = 0; k < cur_vaus.length; k++) {
      const new_molecule = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vaus[k]);
      if (new_molecule !== null) {
        cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
        break;
      }
    }
  } else if (input.keyboard.wasPressed(KeyCode.KeyV)) {
    // apply all vaus to whole molecule until one works, until none of them work
    let any_changes = true;
    while (any_changes) {
      any_changes = false;
      for (let k = 0; k < cur_vaus.length; k++) {
        const new_molecule = afterRecursiveVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vaus[k]);
        if (new_molecule !== null) {
          cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
          any_changes = true;
          break;
        }
      }
    }
  }


  ctx.lineWidth = 2;
  drawMolecule(cur_base_molecule, advanceAnim(cur_molecule_view.anim, delta_time));
  drawMolecule(cur_target, target_view);

  drawVau(cur_vau, base_vau_view);
  if (cur_vau_index > 0) {
    drawVau(cur_vaus[cur_vau_index - 1], top_vau_view);
  }
  if (cur_vau_index + 1 < cur_vaus.length) {
    drawVau(cur_vaus[cur_vau_index + 1], bottom_vau_view);
  }

  toolbar_atoms.forEach(({ view, value }) => drawMolecule(value, view));
  toolbar_templates.forEach(({ view, value }) => drawMatcher(value, view));

  const mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
  {
    // menu button
    if (button("Menu", new Rectangle(new Vec2(canvas_size.x * .85, 0), new Vec2(canvas_size.x * .15, canvas_size.x * .1)))) {
      save_cur_level();
      STATE = "menu"
      return;
    }
  }

  {
    // select test case
    if (cur_test_case > 0) {
      if (button('<', Rectangle.fromParams({ bottomLeft: new Vec2(0, canvas.height), size: new Vec2(50, 50) }))) {
        cur_test_case -= 1;
        [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
      }
    }
    if (button('>', Rectangle.fromParams({ bottomLeft: new Vec2(150, canvas.height), size: new Vec2(50, 50) }))) {
      cur_test_case += 1;
      [cur_base_molecule, cur_target] = cur_level.get_test(cur_test_case);
    }

    ctx.fillStyle = "black";
    fillText(ctx, `Test ${cur_test_case}`, new Vec2(100, canvas.height - 25));
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
  }
  if (cur_mouse_place.type === "molecule" && input.mouse.wasPressed(MouseButton.Right)) {
    // TODO: better lerp
    cur_molecule_address = cur_mouse_place.molecule_address;
    cur_molecule_view.updateTarget();
  }
  switch (mouse_state.type) {
    case "none": {
      switch (cur_mouse_place.type) {
        case "none":
          break;
        case "molecule":
          drawMoleculeHighlight(getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_base_molecule, cur_mouse_place.molecule_address) };
          }
          break;
        case "vau_molecule":
          drawMoleculeHighlight(getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_vau.right, cur_mouse_place.vau_molecule_address) };
          }
          break;
        case "vau_matcher":
          drawMatcherHighlight(getMatcherGrandchildView(base_vau_view, cur_mouse_place.vau_matcher_address), "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: getAtAddress(cur_vau.left, cur_mouse_place.vau_matcher_address) };
          }
          break;
        case "toolbar_atoms":
          drawMoleculeHighlight(toolbar_atoms[cur_mouse_place.atom_index].view, "cyan");
          if (input.mouse.wasPressed(MouseButton.Left)) {
            mouse_state = { type: "holding", source: cur_mouse_place, value: toolbar_atoms[cur_mouse_place.atom_index].value };
          }
          break;
        case "toolbar_templates":
          drawMatcherHighlight(toolbar_templates[cur_mouse_place.template_index].view, "cyan");
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
          drawMoleculeHighlight(getGrandchildView(cur_molecule_view.cur, mouse_state.source.molecule_address), "blue");
          break;
        case "vau_molecule":
          drawMoleculeHighlight(getGrandchildView(getVauMoleculeView(base_vau_view), mouse_state.source.vau_molecule_address), "blue");
          break;
        case "vau_matcher":
          drawMatcherHighlight(getMatcherGrandchildView(base_vau_view, mouse_state.source.vau_matcher_address), "blue");
          break;
        case "toolbar_atoms":
          drawMoleculeHighlight(getGrandchildView(toolbar_atoms[mouse_state.source.atom_index].view, []), "blue");
          break;
        case "toolbar_templates":
          drawMatcherHighlight(toolbar_templates[mouse_state.source.template_index].view, "blue");
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
          drawMoleculeHighlight(getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address), "Chartreuse");
          ctx.globalAlpha = .5;
          drawMolecule(mouse_state.value, getGrandchildView(cur_molecule_view.cur, cur_mouse_place.molecule_address));
          ctx.globalAlpha = 1;
          if (input.mouse.wasReleased(MouseButton.Left)) {
            cur_base_molecule = setAtAddress(cur_base_molecule, cur_mouse_place.molecule_address, mouse_state.value);
          }
          break;
        case "vau_molecule":
          drawMoleculeHighlight(getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address), "Chartreuse");
          ctx.globalAlpha = .5;
          drawMolecule(mouse_state.value, getGrandchildView(getVauMoleculeView(base_vau_view), cur_mouse_place.vau_molecule_address));
          ctx.globalAlpha = 1;
          if (input.mouse.wasReleased(MouseButton.Left)) {
            cur_vau.right = setAtAddress(cur_vau.right, cur_mouse_place.vau_molecule_address, mouse_state.value);
          }
          break;
        case "vau_matcher":
          drawMatcherHighlight(getMatcherGrandchildView(base_vau_view, cur_mouse_place.vau_matcher_address), "Chartreuse");
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
}

// (y_time, x_offset), with x_offset in terms of halfside
// (0, 0) & (1, 0) are implicit
type AtomProfile = Vec2[];
const atom_shapes = new DefaultMap<string, AtomProfile>((_) => [], new Map(Object.entries({
  '0': [new Vec2(.75, -.25)],
  '1': [new Vec2(.2, .2), new Vec2(.8, .2)],
  '2': [new Vec2(1 / 6, .2), new Vec2(.5, -.2), new Vec2(5 / 6, .2)],
  '3': fromCount(10, k => {
    let t = k / 10;
    return new Vec2(t, -.2 * Math.sin(t * Math.PI));
  }),
  '4': [new Vec2(.2, .2), new Vec2(.4, -.2), new Vec2(.7, .2)],
  '5': [new Vec2(.5, .25)],
  '6': fromCount(2, k => {
    let c = (2 * k + 1) / 4;
    let s = .6 / 4;
    return [new Vec2(c - s, 0), new Vec2(c, -.25), new Vec2(c + s, 0)];
  }).flat(1),
  // '5': [new Vec2(.2, 0), new Vec2(.5, .2), new Vec2(.8, 0)],
  // '5': 
})));

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
