const COLORS = {
  background: Color.fromInt(0x6e6e6e),
  cons: Color.fromInt(0x404040),
};

import GUI from "lil-gui";
import { Grid2D } from "./kommon/grid2D";
import { DoubledCoord, Hex, HexMap, Layout, OffsetCoord } from "./kommon/hex";
import { Input, KeyCode, Mouse, MouseButton } from "./kommon/input";
import { Color, NaiveSpriteGraphics, ShakuStyleGraphics, initCtxFromSelector, initGlFromSelector } from "./kommon/kanvas";
import { fromCount, objectMap, zip2 } from "./kommon/kommon";
import { Rectangle, Vec2, mod, towards as approach, lerp } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";

import grammar from "./sexpr.pegjs?raw"
import * as peggy from "peggy";

// parser.parse(str)
const parseSexpr: (input: string) => Sexpr = (() => {
  let parser = peggy.generate(grammar);
  return parser.parse
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
let canvas_size = new Vec2(canvas.width, canvas.height);

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
  // gui.domElement.style.bottom = "0px";
  // gui.domElement.style.top = "auto";
  // gui.hide();
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
let cur_base_molecule = parseSexpr(`(+  (1 1 1) . (1 1 1))`);
let cur_molecule_address = [] as Address;
const base_molecule_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.1, .5)),
  halfside: 200,
}

const cur_vaus: Pair[] = [
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

type Address = boolean[];

function getAtAddress(molecule: Sexpr, address: Address): Sexpr | null {
  let result = molecule;
  for (let k = 0; k < address.length; k++) {
    if (result.type === "atom") return null;
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

function setAtAddress(molecule: Sexpr, address: Address, value: Sexpr): Sexpr {
  if (address.length === 0) return value;
  let result = cloneSexpr(molecule);
  let parent = result;
  for (let k = 0; k < address.length - 1; k++) {
    if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
    parent = address[k] ? parent.left : parent.right;
  }
  if (parent.type === "atom") throw new Error(`cant set ${molecule} at address ${address}`);
  if (address[address.length]) {
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
      let left_match = generateBindings(molecule.left, template.left, [...address, true]);
      let right_match = generateBindings(molecule.right, template.right, [...address, false]);
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
      let matching_binding = bindings.find(({ name }) => name === template.value);
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
  let bindings = generateBindings(molecule, vau.left);
  if (bindings === null) return null;
  return applyBindings(vau.right, bindings);
}


function isValidAddress(molecule: Sexpr, address: Address): boolean {
  return getAtAddress(molecule, address) !== null;
}

const colorFromAtom: (atom: string) => Color = (() => {
  var generated = new Map<string, Color>();
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
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value).toHex();
      moveTo(ctx, view.pos.addX(-view.halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-view.halfside));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, -view.halfside)));
      lineTo(ctx, view.pos.add(new Vec2(view.halfside * 2, view.halfside)));
      lineTo(ctx, view.pos.addY(view.halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    let halfside = view.halfside;
    ctx.beginPath();
    ctx.fillStyle = COLORS.cons.toHex();
    moveTo(ctx, view.pos.addX(-halfside * spike_perc));
    lineTo(ctx, view.pos.addY(-halfside));
    let middle_right_pos = view.pos.addX(halfside / 2);
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

// Given that the child at the given path has the given view, get the grandparents view
function getGrandparentView(child: MoleculeView, path_to_child: Address): MoleculeView {
  let result = child;
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

type VauView = { pos: Vec2, halfside: number };
function drawVau(data: Pair, view: VauView) {
  drawVau_matcher(data.left, view);
  drawMolecule(data.right, {
    halfside: view.halfside,
    pos: view.pos.add(new Vec2(spike_perc * view.halfside / 2, view.halfside / 2)),
  });
}

function drawVau_matcher(data: Sexpr, view: VauView) {
  if (data.type === "atom") {
    if (data.value[0] === "@") {
      let halfside = view.halfside;
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
      let halfside = view.halfside;
      ctx.beginPath();
      ctx.fillStyle = colorFromAtom(data.value).toHex();
      moveTo(ctx, view.pos.addX(halfside * spike_perc));
      lineTo(ctx, view.pos.addY(-halfside));
      lineTo(ctx, view.pos.add(new Vec2(-halfside, -halfside)));
      lineTo(ctx, view.pos.add(new Vec2(-halfside, halfside)));
      lineTo(ctx, view.pos.addY(halfside));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    let halfside = view.halfside;
    ctx.beginPath();
    ctx.fillStyle = COLORS.cons.toHex();
    moveTo(ctx, view.pos.addX(halfside * spike_perc));
    lineTo(ctx, view.pos.addY(-halfside));
    let middle_right_pos = view.pos.addX(-halfside);
    lineTo(ctx, middle_right_pos.add(new Vec2(0, -halfside)));
    lineTo(ctx, middle_right_pos.add(new Vec2(spike_perc * halfside / 2, -halfside / 2)));
    lineTo(ctx, middle_right_pos);
    lineTo(ctx, middle_right_pos.add(new Vec2(spike_perc * halfside / 2, halfside / 2)));
    lineTo(ctx, middle_right_pos.add(new Vec2(0, halfside)));
    lineTo(ctx, view.pos.addY(halfside));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    drawVau_matcher(data.left, getVauMatcherChildView(view, true));
    drawVau_matcher(data.right, getVauMatcherChildView(view, false));
  }
  // drawVau_matcher(data.left, view);
}

function getVauMatcherChildView(parent: VauView, is_left: boolean): VauView {
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

let cur_molecule_view = {
  lerp: lerpMoleculeViews,
  duration: .1,
  setTarget: function (v: MoleculeView): void {
    this.anim = makeLerpAnim(getFinalValue(this.anim), v, this.duration, this.lerp);
  },
  anim: makeConstantAnim(base_molecule_view),
  updateTarget: function (): void {
    let new_target = getGrandparentView(base_molecule_view, cur_molecule_address);
    this.setTarget(new_target);
  }
}

let last_timestamp = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp: number) {
  // in seconds
  let delta_time = (cur_timestamp - last_timestamp) / 1000;
  last_timestamp = cur_timestamp;
  input.startFrame();

  spike_perc = CONFIG.tmp01;

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

  if (input.keyboard.wasPressed(KeyCode.KeyI)) {
    cur_vau_index = mod(cur_vau_index - 1, cur_vaus.length);
  }
  if (input.keyboard.wasPressed(KeyCode.KeyK)) {
    cur_vau_index = mod(cur_vau_index + 1, cur_vaus.length);
  }


  if (input.keyboard.wasPressed(KeyCode.Space)) {
    let new_molecule = afterVau(getAtAddress(cur_base_molecule, cur_molecule_address)!, cur_vaus[cur_vau_index]);
    if (new_molecule !== null) {
      cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
    }
  }

  gl.clear(gl.COLOR_BUFFER_BIT);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 2;
  drawMolecule(cur_base_molecule, advanceAnim(cur_molecule_view.anim, delta_time));

  drawVau(cur_vaus[cur_vau_index], {
    pos: canvas_size.mul(new Vec2(.7, .5)).addX(CONFIG.tmp250 - 250),
    halfside: 200,
  })

  requestAnimationFrame(every_frame);
}

////// library stuff

function single<T>(arr: T[]) {
  if (arr.length === 0) {
    throw new Error("the array was empty");
  } else if (arr.length > 1) {
    throw new Error(`the array had more than 1 element: ${arr}`);
  } else {
    return arr[0];
  }
}

function at<T>(arr: T[], index: number): T {
  if (arr.length === 0) throw new Error("can't call 'at' with empty array");
  return arr[mod(index, arr.length)];
}

const loading_screen_element = document.querySelector<HTMLDivElement>("#loading_screen")!;
if (loading_screen_element) {

  loading_screen_element.innerText = "Press to start!";
  document.addEventListener("pointerdown", _event => {
    loading_screen_element.style.opacity = "0";
    requestAnimationFrame(every_frame);
  }, { once: true });
} else {
  requestAnimationFrame(every_frame);
}
