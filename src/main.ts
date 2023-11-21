import GUI from "lil-gui";
import { Input, KeyCode, MouseButton } from "./kommon/input";
import { Color, NaiveSpriteGraphics, ShakuStyleGraphics, initCtxFromSelector, initGlFromSelector } from "./kommon/kanvas";
import { eqArrays, findIndex, fromCount, objectMap, zip2 } from "./kommon/kommon";
import { Rectangle, Vec2, mod, towards as approach, lerp, inRange } from "./kommon/math";
import { canvasFromAscii } from "./kommon/spritePS";

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
let cur_base_molecule = parseSexpr("(+  (1 1 1) . (+ (1 1) . (1)))");
let cur_molecule_address = [] as Address;
const base_molecule_view: MoleculeView = {
  pos: canvas_size.mul(new Vec2(.1, .5)),
  halfside: 150,
}
const base_vau_view = {
  pos: canvas_size.mul(new Vec2(.7, .5)).addX(CONFIG.tmp250 - 250),
  halfside: 150,
};

const cur_vaus: Pair[] = [
  parseSexpr(`(
    (+ . ((@h . @t) . @b))
    .
    (+ . (@t . (@h . @b)))
  )`) as Pair,
  parseSexpr(`(
    (@a . (nil . @a))
    .
    @a
  )`) as Pair,
  parseSexpr(`(
    (+ . (nil . @a))
    .
    @a
  )`) as Pair,
];
let cur_vau_index = 0;

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

function doPair(left: Sexpr, right: Sexpr): Pair {
  return { type: "pair", left, right };
}

function doAtom(value: string): Atom {
  return { type: "atom", value };
}

let last_timestamp = 0;
// main loop; game logic lives here
function every_frame(cur_timestamp: number) {
  // in seconds
  const delta_time = (cur_timestamp - last_timestamp) / 1000;
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


  const cur_vau = cur_vaus[cur_vau_index];
  if (input.keyboard.wasPressed(KeyCode.Space)) {
    const new_molecule = afterVau(getAtAddress(cur_base_molecule, cur_molecule_address), cur_vau);
    if (new_molecule !== null) {
      cur_base_molecule = setAtAddress(cur_base_molecule, cur_molecule_address, new_molecule);
    }
  }

  gl.clear(gl.COLOR_BUFFER_BIT);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 2;
  drawMolecule(cur_base_molecule, advanceAnim(cur_molecule_view.anim, delta_time));

  drawVau(cur_vau, base_vau_view);

  toolbar_atoms.forEach(({ view, value }) => drawMolecule(value, view));
  toolbar_templates.forEach(({ view, value }) => drawMatcher(value, view));

  const mouse_pos = new Vec2(input.mouse.clientX, input.mouse.clientY);
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
      let no_collision = true;
      switch (mouse_state.source.type) {
        case "molecule":
          drawMoleculeHighlight(getGrandchildView(cur_molecule_view.cur, mouse_state.source.molecule_address), "blue");
          no_collision = (cur_mouse_place.type !== "molecule") || !eqArrays(cur_mouse_place.molecule_address, mouse_state.source.molecule_address);
          break;
        case "vau_molecule":
          drawMoleculeHighlight(getGrandchildView(getVauMoleculeView(base_vau_view), mouse_state.source.vau_molecule_address), "blue");
          no_collision = (cur_mouse_place.type !== "vau_molecule") || !eqArrays(cur_mouse_place.vau_molecule_address, mouse_state.source.vau_molecule_address);
          break;
        case "vau_matcher":
          drawMatcherHighlight(getMatcherGrandchildView(base_vau_view, mouse_state.source.vau_matcher_address), "blue");
          no_collision = (cur_mouse_place.type !== "vau_matcher") || !eqArrays(cur_mouse_place.vau_matcher_address, mouse_state.source.vau_matcher_address);
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

      if (no_collision) {
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
      }
      if (input.mouse.wasReleased(MouseButton.Left)) {
        mouse_state = { type: "none" };
      }
      break;
    }
    default:
      throw new Error("");
  }

  requestAnimationFrame(every_frame);
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
